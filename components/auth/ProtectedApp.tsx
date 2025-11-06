/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Chess } from 'chess.js';

// Import all the different "views" or "screens" of the application.
// Test
import { InitialView } from '../views/InitialView';
import CameraView from '../views/CameraView';
import ImagePreview from '../views/ImagePreview';
import PdfView from '../views/PdfView';
import LoadingView from '../views/LoadingView';
import ResultView from '../views/ResultView';
import SolveView from '../views/SolveView';
import ErrorView from '../views/ErrorView';
import SavedGamesView from '../views/SavedGamesView';
import HistoryView from '../views/HistoryView';
import ProfileView from '../views/ProfileView';
import YoloDebugView from '../views/YoloDebugView';


import { soundManager } from '../../lib/SoundManager';
import { analyzePosition } from '../../lib/fenService';
import { authService, googleDriveService } from '../../lib/authService';
import { useAppSettings } from '../../hooks/useAppSettings';
import { usePdfManager } from '../../hooks/usePdfManager';
import { fenToBoardState } from '../../lib/fenUtils';
import { dataUrlToBlob, computeImageHash, generateBoardThumbnail, determineTurnFromImage } from '../../lib/utils';
import { db } from '../../lib/db';
import type { AppState, PieceColor, AnalysisDetails, HistoryEntry, User } from '../../lib/types';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';

type AnalysisResult = {
    fen: string;
    turn: PieceColor;
    details: AnalysisDetails;
    scanDuration: number | null;
    clientProcessingTime: number | null;
    serverProcessingTime: number | null;
};

type AppSettingsHook = ReturnType<typeof useAppSettings>;

interface ProtectedAppProps {
    onScanComplete: () => void;
    isGuestPastTrial: boolean;
    onAuthRequired: () => void;
    appState: AppState;
    setAppState: (state: AppState) => void;
    previousAppState: AppState;
    appSettings: AppSettingsHook;
    onAdminPanelClick: () => void;
    onSavedGamesClick: () => void;
    onHistoryClick: () => void;
    onProfileClick: () => void;
    triggerUpload: boolean;
    onUploadTriggered: () => void;
}


/**
 * This component contains the entire application logic that is only accessible
 * to logged-in users or guest users in their trial session.
 */
export const ProtectedApp = ({
    onScanComplete, isGuestPastTrial, onAuthRequired,
    appState, setAppState, previousAppState, appSettings, onAdminPanelClick,
    onSavedGamesClick, onHistoryClick, onProfileClick, triggerUpload, onUploadTriggered
}: ProtectedAppProps) => {
    // --- STATE MANAGEMENT ---
    const { user, isLoggedIn, logout, driveAccessToken, authorizeDrive } = useAuth();

    const [imageData, setImageData] = useState<File | null>(null);
    const [croppedImageDataUrl, setCroppedImageDataUrl] = useState<string | null>(null);
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pdfContext, setPdfContext] = useState<{ page: number, totalPages: number } | null>(null);
    const [isRescanning, setIsRescanning] = useState(false);
    const [rescanCounter, setRescanCounter] = useState(0);
    const [initialGameHistory, setInitialGameHistory] = useState<HistoryEntry[] | null>(null);
    const [loadedGameId, setLoadedGameId] = useState<number | undefined>(undefined);
    const [scanFailed, setScanFailed] = useState(false);
    const [scanFailureMessage, setScanFailureMessage] = useState<string | null>(null);
    const [pdfToSync, setPdfToSync] = useState<number | null>(null);
    const [isCameraAvailable, setIsCameraAvailable] = useState<boolean>(true);
    const [scanFlowOrigin, setScanFlowOrigin] = useState<AppState>('initial');


    const {
        storedPdfs, isProcessingPdf, selectedPdf,
        loadStoredPdfs, handlePdfSelect: baseHandlePdfSelect, handleStoredPdfSelect, handleDeletePdf, handlePdfStateChange, clearSelectedPdf
    } = usePdfManager({ setAppState, setError, user });
    
     // --- GOOGLE DRIVE SYNC LOGIC ---
    const syncPdfToDriveWithAuth = useCallback(async (pdfId: number) => {
        if (!user) { 
            return;
        }

        const isGoogle = await authService.isGoogleUser(user);
        if (!isGoogle) {
            console.log("Drive sync is only available for Google users.");
            return;
        }


        const performSync = async (token: string) => {
            try {
                await db.updatePdfDriveInfo(pdfId, 'syncing');
                await loadStoredPdfs();
                const pdfRecord = await db.getPdf(pdfId);
                const driveId = await googleDriveService.uploadFile(pdfRecord.data, token);
                await db.updatePdfDriveInfo(pdfId, 'synced', driveId);
                await loadStoredPdfs();
            } catch (error) {
                console.error(`Failed to sync PDF ${pdfId}:`, error);
                await db.updatePdfDriveInfo(pdfId, 'error');
                await loadStoredPdfs();
            }
        };

        if (driveAccessToken) {
            await performSync(driveAccessToken);
        } else {
            setPdfToSync(pdfId);
        }
    }, [user, driveAccessToken, authorizeDrive, loadStoredPdfs]);

    useEffect(() => {
        if (driveAccessToken && pdfToSync !== null) {
            syncPdfToDriveWithAuth(pdfToSync);
            setPdfToSync(null);
        }
    }, [driveAccessToken, pdfToSync, syncPdfToDriveWithAuth]);

    useEffect(() => {
        const syncLocalFiles = async () => {
            if (user) {
                const isGoogle = await authService.isGoogleUser(user);
                if (isGoogle) {
                    await db.init();
                    const pdfsToSync = await db.getAllPdfs();
                    for (const pdf of pdfsToSync) {
                        if (pdf.syncStatus === 'local' || pdf.syncStatus === 'error') {
                            syncPdfToDriveWithAuth(pdf.id);
                        }
                    }
                }
            }
        };
        syncLocalFiles();
    }, [user, syncPdfToDriveWithAuth]);


    // --- DATA LOADING & INITIALIZATION ---
    useEffect(() => {
        loadStoredPdfs();

        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
            navigator.mediaDevices.enumerateDevices()
                .then(devices => {
                    const hasCamera = devices.some(device => device.kind === 'videoinput');
                    setIsCameraAvailable(hasCamera);
                })
                .catch(err => {
                    console.error("Error enumerating devices:", err);
                    setIsCameraAvailable(false);
                });
        } else {
            setIsCameraAvailable(false);
        }

        let soundInitialized = false;
        const initializeSoundOnInteraction = () => {
            if (!soundInitialized) {
                soundManager.init();
                soundInitialized = true;
            }
            window.removeEventListener('pointerdown', initializeSoundOnInteraction);
        };
        window.addEventListener('pointerdown', initializeSoundOnInteraction);

        return () => window.removeEventListener('pointerdown', initializeSoundOnInteraction);
    }, [loadStoredPdfs]);

    // --- SOUND EFFECTS ---
    useEffect(() => {
        if (error) {
            soundManager.play('ERROR');
        }
    }, [error]);

    // --- NAVIGATION & STATE RESET ---
    const resetToInitial = useCallback(() => {
        setImageData(null);
        setAnalysisResult(null);
        setError(null);
        setPdfContext(null);
        clearSelectedPdf();
        setInitialGameHistory(null);
        setLoadedGameId(undefined);
        setScanFlowOrigin('initial');
        setAppState('initial');
    }, [setAppState, clearSelectedPdf]);

    // --- IMAGE & ANALYSIS WORKFLOW ---
    const handleCropConfirm = async (file: File, clientProcessingTime: number) => {
        setScanFailed(false);
        setScanFailureMessage(null);
        setAppState('loading');
        
        const totalStartTime = performance.now();
    
        try {
            const [serverResult, turnResult] = await Promise.all([
                analyzePosition(file),
                determineTurnFromImage(file)
            ]);

            const { turn: clientSideTurn, ocr_turn_detection_ms, shape_turn_detection_ms, yoloResponse, yoloRequestPayload } = turnResult;

            const total_scan_ms = performance.now() - totalStartTime;
            const serverProcessingTime = serverResult.timings?.total_scan_ms ?? null;

            const fenParts = serverResult.fen.split(' ');
            const serverTurn = fenParts.length > 1 ? fenParts[1] : 'w';
            fenParts[1] = clientSideTurn;
            const correctedFen = fenParts.join(' ');
            
            console.log(`Turn detection: Server indicated '${serverTurn}', Client detected '${clientSideTurn}'. Using client's result.`);

            const finalAnalysisResult: AnalysisResult = {
                fen: correctedFen,
                turn: clientSideTurn,
                details: {
                    ...serverResult.details,
                    failureReason: serverResult.failureReason,
                    yoloResponse,
                    yoloRequestPayload,
                    timingSummary: {
                        ...serverResult.timings,
                        total_scan_ms,
                        ocr_turn_detection_ms,
                        shape_turn_detection_ms,
                    },
                },
                scanDuration: total_scan_ms / 1000,
                clientProcessingTime: clientProcessingTime,
                serverProcessingTime: serverProcessingTime,
            };
    
            setAnalysisResult(finalAnalysisResult);
    
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onloadend = () => {
                setCroppedImageDataUrl(reader.result as string);
            };
            
            onScanComplete();
            setAppState('result');
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error("Analysis Pipeline Failed. Error:", errorMessage, e);
            setScanFailureMessage(errorMessage);
            setScanFailed(true);
        }
    };
    
    const handleFileSelect = (file: File, origin: AppState) => {
        if (isGuestPastTrial) return onAuthRequired();
        setScanFlowOrigin(origin);
        setImageData(file);
        handleCropConfirm(file, 0);
    };

    const handlePdfSelect = async (file: File) => {
        const newId = await baseHandlePdfSelect(file);
        if (newId && user) {
            syncPdfToDriveWithAuth(newId);
        }
    };

    const handleCameraSelect = () => {
        if (isGuestPastTrial) return onAuthRequired();
        setScanFlowOrigin('camera');
        setAppState('camera');
    };
    
    const handleFenLoad = async (fen: string, imageUrl: string) => {
        if (isGuestPastTrial) return onAuthRequired();
        try {
            const blob = await dataUrlToBlob(imageUrl);
            const file = new File([blob], 'sample.jpg', { type: blob.type });
            setImageData(file);
            setCroppedImageDataUrl(imageUrl);
            setAnalysisResult({ fen, turn: fenToBoardState(fen).turn, details: { confidence: null, reasoning: null, uncertainSquares: [] }, scanDuration: null, clientProcessingTime: null, serverProcessingTime: null });
            setAppState('result');
        } catch (e) {
            console.error("Failed to load sample image", e);
            setError("Could not load the sample image.");
            setAppState('error');
        }
    };
    
    const handlePdfCropConfirm = async (file: File, context: { page: number, totalPages: number }, clientProcessingTime: number) => {
        setPdfContext(context);
        setScanFlowOrigin('pdfViewer');
        await handleCropConfirm(file, clientProcessingTime);
    };

    const handlePreScannedPuzzleFound = (fen: string) => {
        soundManager.play('UI_CLICK');

        // If we're coming from the PDF viewer's deep scan results,
        // set the origin so "Next Puzzle" knows where to return.
        if (appState === 'pdfViewer') {
            setScanFlowOrigin('pdfViewer');
        }
        // For ImagePreview, scanFlowOrigin is already correctly set by handleFileSelect/handleCameraSelect.
        
        setAnalysisResult({
            fen: fen,
            turn: fenToBoardState(fen).turn,
            details: { confidence: null, reasoning: 'Loaded from deep scan cache.', uncertainSquares: [] },
            scanDuration: null,
            clientProcessingTime: null,
            serverProcessingTime: null,
        });
        setInitialGameHistory(null);
        setLoadedGameId(undefined);
        setAppState('solve');
    };

    const handleContinueManually = () => {
        setAnalysisResult({
            fen: '8/8/8/8/8/8/8/8 w - - 0 1',
            turn: 'w',
            details: { confidence: null, reasoning: 'Manual board setup after scan failure.', uncertainSquares: [] },
            scanDuration: null,
            clientProcessingTime: null,
            serverProcessingTime: null,
        });
        setCroppedImageDataUrl(null); 
        setAppState('result');
    };

    const handleRescan = async () => {
        if (!croppedImageDataUrl) return;
        setIsRescanning(true);
        try {
            const blob = await dataUrlToBlob(croppedImageDataUrl);
            const file = new File([blob], 'rescan.webp', { type: 'image/webp' });
            
            const totalStartTime = performance.now();

            const [serverResult, turnResult] = await Promise.all([
                analyzePosition(file, true),
                determineTurnFromImage(file)
            ]);

            const { turn: clientSideTurn, ocr_turn_detection_ms, shape_turn_detection_ms, yoloResponse, yoloRequestPayload } = turnResult;

            const total_scan_ms = performance.now() - totalStartTime;
            const serverProcessingTime = serverResult.timings?.total_scan_ms ?? null;
            
            const fenParts = serverResult.fen.split(' ');
            const serverTurn = fenParts.length > 1 ? fenParts[1] : 'w';
            fenParts[1] = clientSideTurn;
            const correctedFen = fenParts.join(' ');
            
            console.log(`Turn detection (Rescan): Server indicated '${serverTurn}', Client detected '${clientSideTurn}'. Using client's result.`);

            setAnalysisResult({
                fen: correctedFen,
                turn: clientSideTurn,
                details: {
                    ...serverResult.details,
                    yoloResponse,
                    yoloRequestPayload,
                    timingSummary: {
                        ...serverResult.timings,
                        ocr_turn_detection_ms,
                        shape_turn_detection_ms
                    }
                },
                scanDuration: total_scan_ms / 1000,
                clientProcessingTime: null,
                serverProcessingTime: serverProcessingTime,
            });
            setRescanCounter(c => c + 1);
        } catch(e) {
            console.error("Rescan failed", e);
            alert("Rescan failed. Please try starting over.");
        } finally {
            setIsRescanning(false);
        }
    };

    const handleAnalyze = (fen: string) => {
        soundManager.play('UI_CLICK');
        setAnalysisResult({ ...analysisResult!, fen });
        setInitialGameHistory(null);
        setLoadedGameId(undefined);
        setAppState('solve');
    };
    
    const handleNextPuzzle = (sourceView: AppState) => {
        soundManager.play('UI_CLICK');
        if (sourceView === 'savedGames') {
            setAppState('savedGames');
            return;
        }
        if (sourceView === 'history') {
            setAppState('history');
            return;
        }
    
        if (scanFlowOrigin === 'pdfViewer') {
            setAppState('pdfViewer');
        } else if (scanFlowOrigin === 'camera') {
            setAppState('camera');
        } else {
            resetToInitial();
        }
    };

    const handleSavedGameSelect = async (id: number) => {
        try {
            const game = await db.getGame(id);
            setAnalysisResult({
                fen: game.initialFen,
                turn: fenToBoardState(game.initialFen).turn,
                details: { confidence: null, reasoning: 'Loaded from saved games.', uncertainSquares: [] },
                scanDuration: null,
                clientProcessingTime: null,
                serverProcessingTime: null,
            });
            setInitialGameHistory(game.moveHistory);
            setLoadedGameId(id);
            setAppState('solve');
        } catch (e) {
            console.error("Failed to load saved game:", e);
            setError("Could not load the selected game.");
            setAppState('error');
        }
    };

    const handleHistorySelect = async (id: number) => {
        try {
            const game = await db.getHistory(id);
            setAnalysisResult({
                fen: game.initialFen,
                turn: fenToBoardState(game.initialFen).turn,
                details: { confidence: null, reasoning: 'Loaded from history.', uncertainSquares: [] },
                scanDuration: null,
                clientProcessingTime: null,
                serverProcessingTime: null,
            });
            setInitialGameHistory(game.moveHistory);
            setLoadedGameId(id);
            setAppState('solve');
        } catch (e) {
            console.error("Failed to load game from history:", e);
            setError("Could not load the selected game from history.");
            setAppState('error');
        }
    };
    
    const handleBack = () => {
        soundManager.play('UI_CLICK');
        setAppState(previousAppState);
    };


    const renderContent = () => {
        switch (appState) {
            case 'initial':
                return (
                    <InitialView
                        onFileSelect={(file) => handleFileSelect(file, 'initial')}
                        onPdfSelect={handlePdfSelect}
                        onCameraSelect={handleCameraSelect}
                        onFenLoad={handleFenLoad}
                        onStoredPdfSelect={handleStoredPdfSelect}
                        onDeletePdf={handleDeletePdf}
                        onSavedGamesClick={onSavedGamesClick}
                        onHistoryClick={onHistoryClick}
                        onSyncRetry={syncPdfToDriveWithAuth}
                        storedPdfs={storedPdfs}
                        isProcessingPdf={isProcessingPdf}
                        onAuthRequired={onAuthRequired}
                        appSettings={appSettings}
                        onAdminPanelClick={onAdminPanelClick}
                        isCameraAvailable={isCameraAvailable}
                        onProfileClick={onProfileClick}
                        triggerUpload={triggerUpload}
                        onUploadTriggered={onUploadTriggered}
                    />
                );
            case 'camera':
                return <CameraView onCapture={(file) => handleFileSelect(file, 'camera')} onBack={resetToInitial} />;
            case 'preview':
                return imageData && <ImagePreview imageFile={imageData} onPuzzleSelect={handlePreScannedPuzzleFound} onBack={resetToInitial} />;
            case 'pdfViewer':
                return selectedPdf && <PdfView 
                    pdfId={selectedPdf.id}
                    pdfFile={selectedPdf.file} 
                    initialPage={selectedPdf.lastPage}
                    initialZoom={selectedPdf.lastZoom}
                    onCropConfirm={handlePdfCropConfirm} 
                    onBack={resetToInitial} 
                    onStateChange={handlePdfStateChange}
                    onPreScannedPuzzleFound={handlePreScannedPuzzleFound}
                />;
            case 'loading':
                return <LoadingView onCancel={resetToInitial} scanFailed={scanFailed} onRetry={() => imageData && handleCropConfirm(imageData, 0)} imageFile={imageData} errorMessage={scanFailureMessage} onContinueManually={handleContinueManually} />;
            case 'result':
                return analysisResult && (
                    <ResultView 
                        initialFen={analysisResult.fen} 
                        initialTurn={analysisResult.turn} 
                        originalImage={croppedImageDataUrl} 
                        onBack={resetToInitial} 
                        onAnalyze={handleAnalyze} 
                        analysisDetails={analysisResult.details}
                        scanDuration={analysisResult.scanDuration}
                        clientProcessingTime={analysisResult.clientProcessingTime}
                        serverProcessingTime={analysisResult.serverProcessingTime}
                        onRescan={handleRescan}
                        isRescanning={isRescanning}
                        onRescanComplete={rescanCounter}
                        user={user}
                        isLoggedIn={isLoggedIn}
                        onLogout={logout}
                        onAdminPanelClick={onAdminPanelClick}
                        onSavedGamesClick={onSavedGamesClick}
                        onHistoryClick={onHistoryClick}
                        onAuthRequired={onAuthRequired}
                        appSettings={appSettings}
                        onProfileClick={onProfileClick}
                    />
                );
            case 'solve':
                return analysisResult && (
                    <SolveView 
                        initialFen={analysisResult.fen}
                        scanDuration={analysisResult.scanDuration}
                        analysisDetails={analysisResult.details}
                        clientProcessingTime={analysisResult.clientProcessingTime}
                        serverProcessingTime={analysisResult.serverProcessingTime}
                        onBack={() => {
                            setInitialGameHistory(null);
                            setLoadedGameId(undefined);
                            setAppState('result');
                        }}
                        onHome={resetToInitial}
                        appSettings={appSettings}
                        onNextPuzzle={handleNextPuzzle}
                        source={pdfContext ? 'pdf' : 'image'}
                        initialHistory={initialGameHistory}
                        sourceView={previousAppState}
                        initialGameId={loadedGameId}
                        user={user}
                        isLoggedIn={isLoggedIn}
                        onLogout={logout}
                        onAdminPanelClick={onAdminPanelClick}
                        onSavedGamesClick={onSavedGamesClick}
                        onHistoryClick={onHistoryClick}
                        onAuthRequired={onAuthRequired}
                        onProfileClick={onProfileClick}
                    />
                );
            case 'savedGames':
                return <SavedGamesView onGameSelect={handleSavedGameSelect} onBack={handleBack} />;
             case 'history':
                return <HistoryView onGameSelect={handleHistorySelect} onBack={handleBack} />;
            case 'profile':
                return <ProfileView onBack={() => setAppState(previousAppState)} />;
            case 'yoloDebug':
                return <YoloDebugView onBack={() => setAppState('initial')} />;
            case 'error':
                return <ErrorView message={error || 'An unknown error occurred.'} onRetry={resetToInitial} />;
            default:
                return <div>Invalid state</div>;
        }
    };


    return (
        <>
            {renderContent()}
        </>
    );
};