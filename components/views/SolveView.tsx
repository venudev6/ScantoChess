/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { PieceSymbol as ChessJSPieceSymbol, Square as ChessJSSquare, Move } from 'chess.js';
import { Chess } from 'chess.js';
import Chessboard from '../Chessboard';
import CapturedPieces from '../ui/CapturedPieces';
import MoveHistory from '../ui/MoveHistory';
import { soundManager } from '../../lib/SoundManager';
import { BackIcon, FlipIcon, FirstMoveIcon, PrevMoveIcon, NextMoveIcon, LastMoveIcon, BookmarkIcon, BookmarkFilledIcon, CheckIcon, CloseIcon, ShareIcon, DownloadIcon, CopyIcon } from '../ui/Icons';
import { PIECE_SETS, PIECE_NAMES } from '../../lib/chessConstants';
import { useChessGame } from '../../hooks/useChessGame';
import { useBoardDrawing } from '../../hooks/useBoardDrawing';
import { useCapturedPieces } from '../../hooks/useCapturedPieces';
import { db } from '../../lib/db';
import { generateBoardThumbnail, generateBoardImageForSharing } from '../../lib/utils';
import type { AppState, PieceColor, PieceSymbol, HistoryEntry, User, StoredGame, AnalysisDetails } from '../../lib/types';
import UserPanel from '../result/UserPanel';
import { useAppSettings } from '../../hooks/useAppSettings';
import './SolveView.css';
import { useStockfish } from '../../hooks/useStockfish';

// --- Helper for Share Modal ---
const convertSvgToPngDataURL = (svgUrl: string, width: number, height: number): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/png'));
            } else {
                reject(new Error("Could not get canvas context."));
            }
        };
        img.onerror = () => reject(new Error("Failed to load SVG image for conversion."));
        img.src = svgUrl;
    });
};


// --- Share Modal Component ---
interface ShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    chessInstance: Chess;
    history: HistoryEntry[];
    initialFen: string;
}

const ShareModal = ({ isOpen, onClose, chessInstance, history, initialFen }: ShareModalProps) => {
    const [pngDataUrl, setPngDataUrl] = useState('');
    const [copyState, setCopyState] = useState<{ fen: 'idle' | 'copied'; pgn: 'idle' | 'copied'; image: 'idle' | 'copied'; }>({ fen: 'idle', pgn: 'idle', image: 'idle' });
    
    const pgn = useMemo(() => {
        if (!isOpen) return '';
        const tempGame = new Chess(initialFen);
        history.forEach(move => {
            try {
                tempGame.move({ from: move.from, to: move.to, promotion: move.promotion });
            } catch(e) { /* ignore invalid moves */ }
        });
        return tempGame.pgn();
    }, [isOpen, history, initialFen]);

    useEffect(() => {
        if (isOpen) {
            const fen = chessInstance.fen();
            const svgUrl = generateBoardImageForSharing(fen);
            convertSvgToPngDataURL(svgUrl, 400, 400).then(setPngDataUrl).catch(console.error);
        } else {
            setPngDataUrl('');
        }
    }, [isOpen, chessInstance]);
    
    const handleCopy = (text: string, type: 'fen' | 'pgn') => {
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            setCopyState(prev => ({ ...prev, [type]: 'copied' }));
            setTimeout(() => setCopyState(prev => ({...prev, [type]: 'idle'})), 2000);
        });
    };
    
    const handleCopyImage = async () => {
        if (!pngDataUrl) return;
        try {
            const response = await fetch(pngDataUrl);
            const blob = await response.blob();
            await navigator.clipboard.write([ new ClipboardItem({ 'image/png': blob }) ]);
            setCopyState(prev => ({ ...prev, image: 'copied' }));
            setTimeout(() => setCopyState(prev => ({...prev, image: 'idle'})), 2000);
        } catch (err) {
            console.error('Failed to copy image: ', err);
            alert('Failed to copy image to clipboard. Your browser might not support this feature or require a secure context (HTTPS).');
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="bookmark-modal-overlay" onClick={onClose}>
            <div className="bookmark-modal share-modal" onClick={(e) => e.stopPropagation()}>
                <div className="bookmark-modal-header">
                    <h3>Share Position</h3>
                    <button onClick={onClose} className="close-btn"><CloseIcon /></button>
                </div>
                <div className="share-image-preview">
                    {pngDataUrl ? <img src={pngDataUrl} alt="Chess position preview" /> : <div className="share-image-placeholder"><div className="spinner"></div></div>}
                </div>
                <div className="bookmark-form-group">
                    <label>Export Image</label>
                    <div className="share-button-group">
                         <a href={pngDataUrl} download={`chess-position.png`} className="btn btn-secondary"><DownloadIcon /> Download PNG</a>
                        <button className="btn btn-secondary" onClick={handleCopyImage}>{copyState.image === 'copied' ? <CheckIcon/> : <CopyIcon />} Copy Image</button>
                    </div>
                </div>
                <div className="bookmark-form-group">
                    <label htmlFor="fen-share">FEN</label>
                    <div className="fen-input-wrapper">
                        <input id="fen-share" type="text" value={chessInstance.fen()} readOnly className="fen-input" />
                        <button className="btn-icon copy-fen-btn" onClick={() => handleCopy(chessInstance.fen(), 'fen')} title="Copy FEN">{copyState.fen === 'copied' ? <CheckIcon /> : <CopyIcon />}</button>
                    </div>
                </div>
                <div className="bookmark-form-group">
                    <label htmlFor="pgn-share">PGN (Main Line)</label>
                    <div className="fen-input-wrapper">
                        <textarea id="pgn-share" value={pgn} readOnly className="fen-input" rows={2}></textarea>
                        <button className="btn-icon copy-fen-btn" onClick={() => handleCopy(pgn, 'pgn')} title="Copy PGN">{copyState.pgn === 'copied' ? <CheckIcon /> : <CopyIcon />}</button>
                    </div>
                </div>
                 <div className="bookmark-modal-actions">
                    <button className="btn btn-primary" onClick={onClose}>Done</button>
                </div>
            </div>
        </div>,
        document.body
    );
};


// --- Bookmark Modal Component ---
interface BookmarkModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (name: string, folder: string) => Promise<void>;
    onRemove: () => Promise<void>;
    initialGame: StoredGame | null;
    anchorRect: DOMRect | null;
}

const BookmarkModal = ({ isOpen, onClose, onSave, onRemove, initialGame, anchorRect }: BookmarkModalProps) => {
    const [name, setName] = useState('');
    const [selectedFolder, setSelectedFolder] = useState('Default');
    const [newFolderName, setNewFolderName] = useState('');
    const [isCreatingNewFolder, setIsCreatingNewFolder] = useState(false);
    const [allFolders, setAllFolders] = useState<string[]>([]);
    const modalRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            const fetchFolders = async () => {
                const folders = await db.getAllFolders();
                setAllFolders(folders);
            };
            fetchFolders();
            
            setName(initialGame?.name || `Game from ${new Date().toLocaleDateString()}`);
            setSelectedFolder(initialGame?.folder || 'Default');
            setIsCreatingNewFolder(false);
            setNewFolderName('');
        }
    }, [isOpen, initialGame]);

    if (!isOpen || !anchorRect) return null;

    const modalStyle: React.CSSProperties = {
        position: 'absolute',
        top: `${anchorRect.bottom + 8}px`,
        right: `${window.innerWidth - anchorRect.right}px`,
    };

    const handleFolderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        if (e.target.value === '__new__') {
            setIsCreatingNewFolder(true);
        } else {
            setSelectedFolder(e.target.value);
            setIsCreatingNewFolder(false);
        }
    };

    const handleSaveClick = () => {
        const folder = isCreatingNewFolder ? (newFolderName.trim() || 'Default') : selectedFolder;
        onSave(name.trim(), folder);
    };

    return createPortal(
        <div className="bookmark-modal-overlay" onClick={onClose}>
            <div className="bookmark-modal" ref={modalRef} style={modalStyle} onClick={(e) => e.stopPropagation()}>
                <div className="bookmark-modal-header">
                    <h3>{initialGame ? 'Edit Bookmark' : 'Add Bookmark'}</h3>
                    <button onClick={onClose} className="close-btn"><CloseIcon /></button>
                </div>
                <div className="bookmark-form-group">
                    <label htmlFor="bookmark-name">Name</label>
                    <input id="bookmark-name" type="text" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="bookmark-form-group">
                    <label htmlFor="bookmark-folder">Folder</label>
                    {!isCreatingNewFolder ? (
                        <select id="bookmark-folder" value={selectedFolder} onChange={handleFolderChange}>
                            {!allFolders.includes(selectedFolder) && <option value={selectedFolder}>{selectedFolder}</option>}
                            {allFolders.map(f => <option key={f} value={f}>{f}</option>)}
                            <option value="__new__">Create new folder...</option>
                        </select>
                    ) : (
                        <input type="text" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="New folder name" autoFocus />
                    )}
                </div>
                <div className="bookmark-modal-actions">
                    {initialGame && <button className="btn btn-remove" onClick={onRemove}>Remove</button>}
                    <button className="btn btn-primary" onClick={handleSaveClick}>Done</button>
                </div>
            </div>
        </div>,
        document.body
    );
};

// FIX: Cannot find name 'AppSettingsHook'.
type AppSettingsHook = ReturnType<typeof useAppSettings>;

interface SolveViewProps {
    initialFen: string;
    onBack: () => void;
    onHome: () => void;
    appSettings: AppSettingsHook;
    onNextPuzzle: () => void;
    source: 'pdf' | 'image';
    initialHistory?: HistoryEntry[] | null;
    initialGameId?: number;
    sourceView: AppState;
    user: User | null;
    isLoggedIn: boolean;
    onLogout: () => void;
    onAdminPanelClick: () => void;
    onSavedGamesClick: () => void;
    onHistoryClick: () => void;
    onProfileClick: () => void;
    onAuthRequired: () => void;
    scanDuration: number | null;
    analysisDetails: AnalysisDetails | null;
    clientProcessingTime: number | null;
}

/**
 * The main analysis and interaction view. It allows the user to play through moves,
 * see captured pieces, and navigate the move history.
 */
const SolveView = ({
    initialFen, onBack, onHome, appSettings, onNextPuzzle, source, initialHistory, sourceView, initialGameId,
    user, isLoggedIn, onLogout, onAdminPanelClick, onSavedGamesClick, onHistoryClick, onProfileClick, onAuthRequired, scanDuration, clientProcessingTime,
    analysisDetails
}: SolveViewProps) => {
    const {
        game, rootNode, currentNode, currentBoard, gameStatus,
        selectedSquare, possibleMoves, promotionMove,
        handleSquareClick: originalHandleSquareClick, handlePromotion, navigateHistory, makeRawMove,
        isGameOver, isCheckmate, isCheck, turn,
        isFlipped, setIsFlipped, archiveBranch, restoreBranch
    } = useChessGame(initialFen, initialHistory || undefined);
    
    const stockfish = useStockfish();
    const [playerSide, setPlayerSide] = useState<'w' | 'b' | null>(null);
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const isMakingEngineMove = useRef(false);


    const [highlightedSquares, setHighlightedSquares] = useState<ChessJSSquare[]>([]);
    const { boardAreaRef, renderedArrows, setArrows, handleBoardPointerDown, handleBoardPointerMove, handleBoardPointerUp } = useBoardDrawing(isFlipped, handleSquareRightClick);

    const mainLineHistory = useMemo(() => {
        const line: HistoryEntry[] = [];
        let current = rootNode.children.find(c => !c.archived);
        while (current) {
            line.push(current);
            current = current.children.find(c => !c.archived);
        }
        return line;
    }, [rootNode]);
    
    const historyIndex = useMemo(() => mainLineHistory.findIndex(h => h.id === currentNode.id), [mainLineHistory, currentNode]);

    const { capturedWhitePieces, capturedBlackPieces, materialAdvantage } = useCapturedPieces(mainLineHistory, historyIndex);

    const [cooldown, setCooldown] = useState(appSettings.analysisCooldown);
    const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);
    const [bookmarkedGame, setBookmarkedGame] = useState<StoredGame | null>(null);
    const [isBookmarkModalOpen, setIsBookmarkModalOpen] = useState(false);
    const [bookmarkAnchorRect, setBookmarkAnchorRect] = useState<DOMRect | null>(null);
    const bookmarkButtonRef = useRef<HTMLButtonElement>(null);

    const PIECE_COMPONENTS = PIECE_SETS[appSettings.pieceTheme as keyof typeof PIECE_SETS] || PIECE_SETS['staunty'];
    
    const initialFenRef = useRef(initialFen);
    const historyRef = useRef(mainLineHistory);
    const isInitialHistoryRef = useRef(!!initialHistory);

    useEffect(() => {
        if (appSettings.engineEnabled) {
            if (playerSide === null) {
                setPlayerSide(turn);
            }
        } else {
            setPlayerSide(null);
            stockfish.stopEvaluation();
        }
    }, [appSettings.engineEnabled, playerSide, turn, stockfish.stopEvaluation]);

    useEffect(() => {
        const isComputerTurn = appSettings.engineEnabled && playerSide && turn !== playerSide;

        if (isComputerTurn && !stockfish.isThinking && !isGameOver && !isMakingEngineMove.current) {
            const onBestMoveFound = (move: string) => {
                if (move) {
                    isMakingEngineMove.current = true;
                    const from = move.substring(0, 2) as ChessJSSquare;
                    const to = move.substring(2, 4) as ChessJSSquare;
                    const promotion = move.length > 4 ? move.substring(4) as ChessJSPieceSymbol : undefined;
                    
                    setTimeout(() => {
                        makeRawMove({ from, to, promotion });
                        isMakingEngineMove.current = false;
                    }, 300);
                }
            };
            
            const difficultyToDepth: Record<typeof appSettings.engineDifficulty, number> = {
                standard: 15,
                hard: 20,
                'extra-hard': 22
            };
            const depth = difficultyToDepth[appSettings.engineDifficulty];
            
            stockfish.evaluatePosition(game.fen(), depth, onBestMoveFound);
        } else if (!isComputerTurn && stockfish.isThinking) {
            stockfish.stopEvaluation();
        }
    }, [
        appSettings.engineEnabled,
        appSettings.engineDifficulty,
        playerSide,
        turn,
        stockfish.isThinking,
        isGameOver,
        game,
        makeRawMove,
        stockfish.evaluatePosition,
        stockfish.stopEvaluation
    ]);

    function handleSquareRightClick(square: ChessJSSquare) {
        setHighlightedSquares(prev => {
            if (prev.includes(square)) {
                return prev.filter(s => s !== square);
            } else {
                return [...prev, square];
            }
        });
    }

    const selectedSquareCoords = useMemo(() => {
        if (!selectedSquare) return null;
        const file = selectedSquare.charCodeAt(0) - 'a'.charCodeAt(0);
        const rank = parseInt(selectedSquare.substring(1), 10) - 1;
        return { row: 7 - rank, col: file };
    }, [selectedSquare]);

    const handleBoardClick = useCallback((pos: { row: number; col: number }) => {
        setArrows([]);
        setHighlightedSquares([]);
        originalHandleSquareClick(pos);
    }, [originalHandleSquareClick, setArrows]);

    useEffect(() => { initialFenRef.current = initialFen; }, [initialFen]);
    useEffect(() => { historyRef.current = mainLineHistory; }, [mainLineHistory]);
    useEffect(() => { setCooldown(appSettings.analysisCooldown); }, [appSettings.analysisCooldown]);

    const checkBookmarkStatus = useCallback(async () => {
        await db.init();
        const savedGames = await db.getAllGames();
        const existingGame = savedGames.find(g => g.initialFen === initialFen);
        setBookmarkedGame(existingGame || null);
    }, [initialFen]);

    useEffect(() => {
        checkBookmarkStatus();
    }, [checkBookmarkStatus]);

    useEffect(() => {
        return () => {
            const saveGameToHistory = async () => {
                if (!isInitialHistoryRef.current && historyRef.current.length > 0) { 
                    try {
                        const thumbnail = generateBoardThumbnail(initialFenRef.current);
                        const gameData = { initialFen: initialFenRef.current, date: Date.now(), thumbnail, moveHistory: historyRef.current };
                        await db.init();
                        await db.saveHistory(gameData);
                    } catch (e) {
                        console.error("Failed to auto-save game to history:", e);
                    }
                }
            };
            saveGameToHistory();
        };
    }, []);

    useEffect(() => {
        if (cooldown <= 0) return;
        const timer = setInterval(() => setCooldown(prev => (prev > 0 ? prev - 1 : 0)), 1000);
        return () => clearInterval(timer);
    }, [cooldown]);

    const handleBookmarkClick = () => {
        if (bookmarkButtonRef.current) {
            setBookmarkAnchorRect(bookmarkButtonRef.current.getBoundingClientRect());
        }
        setIsBookmarkModalOpen(true);
    };

    const handleSaveBookmark = async (name: string, folder: string) => {
        try {
            await db.init();
            if (bookmarkedGame) {
                await db.updateGameDetails(bookmarkedGame.id, name, folder);
            } else {
                const thumbnail = generateBoardThumbnail(initialFen);
                await db.saveGame({ name, folder, initialFen, date: Date.now(), thumbnail, moveHistory: mainLineHistory });
            }
            await checkBookmarkStatus();
            setIsBookmarkModalOpen(false);
            setShowSaveConfirmation(true);
            setTimeout(() => setShowSaveConfirmation(false), 2500);
        } catch (e) { console.error("Failed to save bookmark:", e); }
    };

    const handleRemoveBookmark = async () => {
        try {
            if (bookmarkedGame) {
                await db.init();
                await db.deleteGame(bookmarkedGame.id);
                setBookmarkedGame(null);
            }
            setIsBookmarkModalOpen(false);
        } catch (e) { console.error("Failed to remove bookmark:", e); }
    };
    
    const handleNavigateHistory = (nodeId: string) => {
        navigateHistory(nodeId);
    };

    const handlePrevMove = () => {
        if (historyIndex > 0) {
            handleNavigateHistory(mainLineHistory[historyIndex - 1].id);
        } else if (historyIndex === 0) {
            handleNavigateHistory(rootNode.id);
        }
    };
    
    const handleNextMove = () => {
        if (historyIndex < mainLineHistory.length - 1) {
            handleNavigateHistory(mainLineHistory[historyIndex + 1].id);
        }
    };
    
    const handleFirstMove = () => {
        handleNavigateHistory(rootNode.id);
    };
    
    const handleLastMove = () => {
        if (mainLineHistory.length > 0) {
            handleNavigateHistory(mainLineHistory[mainLineHistory.length - 1].id);
        }
    };

    const handleAnalysisClick = (e: React.MouseEvent<HTMLAnchorElement>) => { if (cooldown > 0) e.preventDefault(); };

    const lastMove = historyIndex >= 0 ? { from: mainLineHistory[historyIndex].from, to: mainLineHistory[historyIndex].to } : null;
    const backButtonTitle = sourceView === 'result' ? "Back to Editor" : "Back to List";
    const nextButtonText = source === 'pdf' ? 'Back to PDF' : 'New Scan';
    const nextButtonTitle = source === 'pdf' ? 'Return to PDF viewer' : 'Start a new scan';

    return (
        <div className="card solve-view-card">
            
            <div className="solve-view-container">
                 <UserPanel 
                    user={user} 
                    isLoggedIn={isLoggedIn} 
                    onLogout={onLogout} 
                    onAdminPanelClick={onAdminPanelClick} 
                    onSavedGamesClick={onSavedGamesClick} 
                    onHistoryClick={onHistoryClick} 
                    onLoginClick={onAuthRequired} 
                    onProfileClick={onProfileClick} 
                    appSettings={appSettings} 
                    scanDuration={scanDuration} 
                    clientProcessingTime={clientProcessingTime}
                    analysisDetails={analysisDetails} 
                    displayMode="compact"
                    debugLog={stockfish.debugLog}
                    bestMove={stockfish.bestMove}
                    isEngineReady={stockfish.isReady}
                    isThinking={stockfish.isThinking}
                    playerSide={playerSide}
                    turn={turn}
                />
                <div className="board-area" ref={boardAreaRef} onContextMenu={(e) => e.preventDefault()} onPointerDown={handleBoardPointerDown} onPointerMove={handleBoardPointerMove} onPointerUp={handleBoardPointerUp}>
                    <Chessboard 
                        boardState={currentBoard} 
                        onSquareClick={handleBoardClick} 
                        selectedSquare={selectedSquareCoords} 
                        lastMove={lastMove}
                        possibleMoves={possibleMoves} 
                        userHighlights={highlightedSquares} 
                        isFlipped={isFlipped} 
                        pieceTheme={appSettings.pieceTheme} 
                    />
                    {renderedArrows.length > 0 && ( <svg className="drawing-overlay" width="100%" height="100%"><defs><marker id="arrowhead" viewBox="0 -24 41.57 48" refX="0" refY="0" markerUnits="userSpaceOnUse" markerWidth="48" markerHeight="48" orient="auto"><polygon points="41.57,0 0,-24 0,24" /></marker></defs>{renderedArrows}</svg> )}
                    {isGameOver && ( <div className="game-over-overlay"><h2>{gameStatus}</h2><button className="btn btn-secondary" onClick={() => { onNextPuzzle(); }}>{nextButtonText}</button></div> )}
                    {showSaveConfirmation && createPortal( <div className="save-toast"><CheckIcon /> Game Saved</div>, document.body )}
                </div>
                <div className="solve-controls">
                    <div className="solve-view-header">
                         <div className="captured-pieces-stack">
                            <CapturedPieces color="b" pieces={capturedBlackPieces} scoreAdvantage={materialAdvantage.blackAdvantage} pieceTheme={appSettings.pieceTheme} />
                            <CapturedPieces color="w" pieces={capturedWhitePieces} scoreAdvantage={materialAdvantage.whiteAdvantage} pieceTheme={appSettings.pieceTheme} />
                        </div>
                    </div>
                    <div className="move-navigation-controls">
                        <button className="btn-icon" onClick={() => { soundManager.play('UI_CLICK'); handleFirstMove(); }} disabled={historyIndex < 0} aria-label="First move" title="Go to the first move"><FirstMoveIcon /></button>
                        <button className="btn-icon" onClick={() => { soundManager.play('UI_CLICK'); handlePrevMove(); }} disabled={historyIndex < 0} aria-label="Previous move" title="Go to previous move"><PrevMoveIcon /></button>
                        <button className="btn-icon" onClick={() => { soundManager.play('UI_CLICK'); setIsFlipped(!isFlipped); }} aria-label="Flip board" title="Flip board orientation"><FlipIcon /></button>
                        <button className="btn-icon" onClick={() => { soundManager.play('UI_CLICK'); handleNextMove(); }} disabled={historyIndex >= mainLineHistory.length - 1} aria-label="Next move" title="Go to next move"><NextMoveIcon /></button>
                        <button className="btn-icon" onClick={() => { soundManager.play('UI_CLICK'); handleLastMove(); }} disabled={historyIndex >= mainLineHistory.length - 1} aria-label="Last move" title="Go to the last move"><LastMoveIcon /></button>
                        <button ref={bookmarkButtonRef} className={`btn-icon ${bookmarkedGame ? 'bookmarked' : ''}`} onClick={handleBookmarkClick} title={bookmarkedGame ? "Edit Bookmark" : "Bookmark Game"} aria-label={bookmarkedGame ? "Edit Bookmark" : "Bookmark Game"}>{bookmarkedGame ? <BookmarkFilledIcon /> : <BookmarkIcon />}</button>
                        <button className="btn-icon" onClick={() => setIsShareModalOpen(true)} title="Share Position" aria-label="Share Position"><ShareIcon /></button>
                    </div>
                    <div className="move-history-wrapper">
                        <MoveHistory 
                            rootNode={rootNode} 
                            currentNode={currentNode} 
                            onNavigate={handleNavigateHistory} 
                            onArchiveBranch={archiveBranch}
                            onRestoreBranch={restoreBranch}
                        />
                        <BookmarkModal isOpen={isBookmarkModalOpen} onClose={() => setIsBookmarkModalOpen(false)} onSave={handleSaveBookmark} onRemove={handleRemoveBookmark} initialGame={bookmarkedGame} anchorRect={bookmarkAnchorRect} />
                    </div>

                    <div className="solve-main-actions">
                        <a className={`btn btn-analyze ${cooldown > 0 ? 'disabled' : ''}`} href={`https://www.chess.com/analysis?fen=${encodeURIComponent(game.fen())}&flip=${turn === 'b'}`} target="_blank" rel="noopener noreferrer" onClick={handleAnalysisClick}>Analysis with chess.com {cooldown > 0 ? `(${Math.floor(cooldown/60)}:${String(cooldown%60).padStart(2,'0')})` : ''}</a>
                        <a className={`btn btn-dark ${cooldown > 0 ? 'disabled' : ''}`} href={`https://lichess.org/analysis/standard/${encodeURIComponent(game.fen())}`} target="_blank" rel="noopener noreferrer" onClick={handleAnalysisClick}>Analysis with Lichess.org {cooldown > 0 ? `(${Math.floor(cooldown/60)}:${String(cooldown%60).padStart(2,'0')})` : ''}</a>
                        <div className="result-actions">
                            <button className="btn btn-secondary btn-back" onClick={() => { onBack(); }} title={backButtonTitle} aria-label={backButtonTitle}><BackIcon/> Back</button>
                            <button className="btn btn-secondary" onClick={() => { onHome(); }} aria-label="Go to Home Screen" title="Return to the home screen">Home</button>
                            <button className="btn btn-analyze" onClick={() => { onNextPuzzle(); }} title={nextButtonTitle}>{nextButtonText}</button>
                        </div>
                    </div>
                </div>

                {promotionMove && createPortal( <div className="promotion-overlay" onClick={() => handlePromotion(null)}><div className="promotion-choices" onClick={e => e.stopPropagation()}>{(['q', 'r', 'b', 'n'] as PieceSymbol[]).map(p => { const PieceComponent = PIECE_COMPONENTS[turn as PieceColor][p]; return ( <PieceComponent key={p} className="piece" aria-label={`Promote to ${PIECE_NAMES[p]}`} onClick={() => handlePromotion(p as ChessJSPieceSymbol)} /> ); })}</div></div>, document.body )}
                
                <ShareModal 
                    isOpen={isShareModalOpen} 
                    onClose={() => setIsShareModalOpen(false)} 
                    chessInstance={game}
                    history={mainLineHistory}
                    initialFen={initialFen}
                />
            </div>
        </div>
    );
};

export default SolveView;