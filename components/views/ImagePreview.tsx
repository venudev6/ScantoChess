/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BackIcon } from '../ui/Icons';
import { analyzePosition } from '../../lib/fenService';
import { detectChessboardsCV, determineTurnFromImage, expandBox } from '../../lib/utils';
import type { DetectedPuzzle, BoundingBox } from '../../lib/types';
import './ImagePreview.css';

interface ImagePreviewProps {
    imageFile: File;
    onPuzzleSelect: (fen: string) => void;
    onMultiPuzzleFound: (puzzles: DetectedPuzzle[], imageFile: File) => void;
    onBack: () => void;
}

// Helper function to create a file from a canvas crop
const canvasCropToFile = async (
    sourceCanvas: HTMLCanvasElement,
    box: BoundingBox,
    fileName: string
): Promise<File | null> => {
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = box.width * sourceCanvas.width;
    croppedCanvas.height = box.height * sourceCanvas.height;
    const ctx = croppedCanvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(
        sourceCanvas,
        box.x * sourceCanvas.width,
        box.y * sourceCanvas.height,
        croppedCanvas.width,
        croppedCanvas.height,
        0, 0,
        croppedCanvas.width,
        croppedCanvas.height
    );

    const blob = await new Promise<Blob | null>(resolve => croppedCanvas.toBlob(resolve, 'image/webp', 0.8));
    if (!blob) return null;

    return new File([blob], fileName, { type: 'image/webp' });
};

/**
 * A view that automatically performs a deep scan on an uploaded image to find
 * all chess puzzles, analyzing them and displaying interactive overlays.
 */
const ImagePreview = ({ imageFile, onPuzzleSelect, onMultiPuzzleFound, onBack }: ImagePreviewProps) => {
    const [imgSrc, setImgSrc] = useState('');
    const [scanState, setScanState] = useState<'scanning' | 'analyzing' | 'done' | 'error'>('scanning');
    const [scanProgress, setScanProgress] = useState({ current: 0, total: 0, message: '' });
    const [scanError, setScanError] = useState<string | null>(null);
    const [detectedPuzzles, setDetectedPuzzles] = useState<DetectedPuzzle[]>([]);
    const [aspectRatio, setAspectRatio] = useState<number | undefined>();
    const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const scanHasRun = useRef(false);
    const isCancelledRef = useRef(false);

    const onCVProgress = useCallback((message: string) => {
        setScanProgress(prev => ({ ...prev, message }));
    }, []);

    const scanImage = useCallback(async () => {
        if (!imgSrc) return;

        setScanState('scanning');
        setScanProgress({ current: 0, total: 0, message: 'Preparing image...' });
        
        const img = new Image();
        const loadPromise = new Promise<void>((resolve, reject) => { 
            img.onload = () => resolve(); 
            img.onerror = reject;
        });
        img.src = imgSrc;

        try {
            await loadPromise;
        } catch (e) {
            setScanState('error');
            setScanError('Could not load the image file.');
            return;
        }

        if (isCancelledRef.current) return;

        setAspectRatio(img.naturalWidth / img.naturalHeight);

        imageCanvasRef.current = document.createElement('canvas');
        imageCanvasRef.current.width = img.naturalWidth;
        imageCanvasRef.current.height = img.naturalHeight;
        const ctx = imageCanvasRef.current.getContext('2d');
        if (!ctx) {
            setScanState('error');
            setScanError('Could not create canvas context.');
            return;
        }
        ctx.drawImage(img, 0, 0);

        try {
            const tightBoxes = await detectChessboardsCV(imageCanvasRef.current, onCVProgress);
            
            if (isCancelledRef.current) return;
            
            if (tightBoxes.length === 0) {
                setScanProgress({ current: 0, total: 0, message: 'No chessboards found.' });
                setTimeout(() => setScanState('done'), 1500);
                return;
            }
            
            setScanState('analyzing');
            const boardCount = tightBoxes.length;
            const message = `Found ${boardCount} board${boardCount === 1 ? '' : 's'}. Analyzing...`;
            setScanProgress({ current: 0, total: boardCount, message });


            const puzzlePromises = tightBoxes.map(async (box, i) => {
                if (isCancelledRef.current) return null;
                
                const PADDING_PERCENT = 0.04;
                const expandedBox = expandBox(box, PADDING_PERCENT);
                const puzzleFile = await canvasCropToFile(imageCanvasRef.current!, expandedBox, `puzzle_${i}.webp`);
                if (!puzzleFile) return { boundingBox: box, fen: '' };

                try {
                    const [fenResult, turnResult] = await Promise.all([
                        analyzePosition(puzzleFile),
                        determineTurnFromImage(puzzleFile)
                    ]);
                    
                    if (isCancelledRef.current) return null;

                    setScanProgress(prev => ({ ...prev, current: prev.current + 1, message: `Analyzing board ${prev.current + 1} of ${tightBoxes.length}...` }));

                    if (fenResult.fen && !fenResult.failureReason) {
                        const { turn: clientTurn } = turnResult;
                        const fenParts = fenResult.fen.split(' ');
                        fenParts[1] = clientTurn;
                        const correctedFen = fenParts.join(' ');
                        return { boundingBox: box, fen: correctedFen };
                    }
                } catch (e) {
                    console.warn(`Analysis failed for puzzle ${i + 1}`, e);
                    setScanProgress(prev => ({ ...prev, current: prev.current + 1 }));
                }
                return { boundingBox: box, fen: '' }; // Placeholder on failure
            });

            const allPuzzles = (await Promise.all(puzzlePromises)).filter(p => p !== null) as DetectedPuzzle[];
            const validPuzzles = allPuzzles.filter(p => p.fen);
            
            if (isCancelledRef.current) return;
            
            if (validPuzzles.length === 1) {
                onPuzzleSelect(validPuzzles[0].fen);
                return;
            }

            if (validPuzzles.length > 1) {
                onMultiPuzzleFound(validPuzzles, imageFile);
            }
            
            setDetectedPuzzles(validPuzzles);
            const foundCount = validPuzzles.length;
            const completeMessage = foundCount > 0 ? `Scan complete! Click a puzzle to begin.` : 'Could not analyze any boards.';

            setScanProgress({ current: allPuzzles.length, total: allPuzzles.length, message: completeMessage });
            setTimeout(() => setScanState('done'), 1000);

        } catch (error) {
            console.error('Deep scan failed:', error);
            setScanError(error instanceof Error ? error.message : 'An unknown error occurred during scan.');
            setScanState('error');
        }
    }, [imgSrc, onCVProgress, onPuzzleSelect, onMultiPuzzleFound, imageFile]);

    useEffect(() => {
        const reader = new FileReader();
        reader.onload = e => setImgSrc(e.target?.result as string);
        reader.readAsDataURL(imageFile);
        
        // Cleanup function for when the component unmounts
        return () => {
            isCancelledRef.current = true;
        };
    }, [imageFile]);

    useEffect(() => {
        // Guard against React Strict Mode's double-invocation in development
        if (imgSrc && !scanHasRun.current) {
            scanHasRun.current = true;
            scanImage();
        }
    }, [imgSrc, scanImage]);
    
    const handlePuzzleClick = (fen: string) => {
        if (fen) {
            onPuzzleSelect(fen);
        }
    };

    return (
        <div className="card image-scan-container">
            <div className="image-scan-header">
                <button className="btn-icon" onClick={onBack} title="Go back" aria-label="Go back"><BackIcon /></button>
            </div>
            <div 
                className="image-scan-content-wrapper"
                style={{ 
                    backgroundImage: imgSrc ? `url(${imgSrc})` : 'none',
                    aspectRatio: aspectRatio,
                }}
            >
                {(scanState === 'scanning' || scanState === 'analyzing') && (
                    <div className="scan-overlay">
                        <div className="spinner" />
                        <p>{scanProgress.message}</p>
                        {scanProgress.total > 0 && <progress value={scanProgress.current} max={scanProgress.total} />}
                        <button className="btn btn-secondary" onClick={onBack}>Cancel</button>
                    </div>
                )}
                
                {scanState === 'done' && detectedPuzzles.length === 0 && (
                    <div className="scan-overlay">
                        <p>No valid chessboards were found in this image.</p>
                    </div>
                )}


                {scanState === 'error' && (
                    <div className="scan-overlay">
                        <h3>Scan Failed</h3>
                        <p>{scanError}</p>
                    </div>
                )}

                {scanState === 'done' && detectedPuzzles.map((puzzle, index) => {
                    const uiBox = expandBox(puzzle.boundingBox, 0.01);
                    return (
                        <button 
                            key={index} 
                            className="puzzle-overlay" 
                            style={{ 
                                left: `${uiBox.x * 100}%`, 
                                top: `${uiBox.y * 100}%`, 
                                width: `${uiBox.width * 100}%`, 
                                height: `${uiBox.height * 100}%` 
                            }} 
                            onClick={() => handlePuzzleClick(puzzle.fen)}
                            title={puzzle.fen ? "Click to analyze this puzzle" : "Analysis failed for this area"}
                        >
                            <span className="corner-marker top-left"></span>
                            <span className="corner-marker top-right"></span>
                            <span className="corner-marker bottom-left"></span>
                            <span className="corner-marker bottom-right"></span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default ImagePreview;