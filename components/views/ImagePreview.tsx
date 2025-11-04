/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BackIcon } from '../ui/Icons';
import { analyzeImagePosition } from '../../lib/gemini';
import { detectChessboardsCV, determineTurnFromImage, expandBox } from '../../lib/utils';
import type { DetectedPuzzle, BoundingBox } from '../../lib/types';
import './ImagePreview.css';

interface ImagePreviewProps {
    imageFile: File;
    onPuzzleSelect: (fen: string) => void;
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
 * all chess puzzles, displaying interactive overlays for each one found.
 */
const ImagePreview = ({ imageFile, onPuzzleSelect, onBack }: ImagePreviewProps) => {
    const [imgSrc, setImgSrc] = useState('');
    const [scanState, setScanState] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle');
    const [scanProgress, setScanProgress] = useState({ current: 0, total: 0, message: '' });
    const [scanError, setScanError] = useState<string | null>(null);
    const [detectedPuzzles, setDetectedPuzzles] = useState<DetectedPuzzle[]>([]);
    const [aspectRatio, setAspectRatio] = useState<number | undefined>();

    const scanImage = useCallback(async () => {
        if (!imgSrc) return;

        setScanState('scanning');
        setScanProgress({ current: 0, total: 0, message: 'Detecting chessboards...' });
        setDetectedPuzzles([]);
        setScanError(null);
        setAspectRatio(undefined);
        
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

        setAspectRatio(img.naturalWidth / img.naturalHeight);

        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            setScanState('error');
            setScanError('Could not create canvas context.');
            return;
        }
        ctx.drawImage(img, 0, 0);

        try {
            const tightBoxes = await detectChessboardsCV(canvas);
            
            if (tightBoxes.length === 0) {
                setScanProgress({ current: 0, total: 0, message: 'No chessboards found.' });
                setTimeout(() => setScanState('done'), 1500);
                return;
            }

            const PADDING_PERCENT = 0.04;
            const expandedBoxes = tightBoxes.map(box => expandBox(box, PADDING_PERCENT));
            
            setScanProgress({ current: 0, total: expandedBoxes.length, message: `Found ${expandedBoxes.length} puzzle(s). Analyzing...` });

            const puzzlePromises = expandedBoxes.map(async (box, i) => {
                const puzzleFile = await canvasCropToFile(canvas, box, `puzzle_${i}.webp`);
                if (!puzzleFile) return null;
                
                try {
                    const [fenResult, turnResult] = await Promise.all([
                        analyzeImagePosition(puzzleFile),
                        determineTurnFromImage(puzzleFile)
                    ]);

                    setScanProgress(prev => ({ ...prev, current: prev.current + 1, message: `Analyzing puzzle ${prev.current + 1} of ${expandedBoxes.length}...`}));

                    if (fenResult.fen && !fenResult.failureReason) {
                        const { turn: clientTurn } = turnResult;
                        const fenParts = fenResult.fen.split(' ');
                        fenParts[1] = clientTurn;
                        const correctedFen = fenParts.join(' ');
                        return { boundingBox: tightBoxes[i], fen: correctedFen };
                    }
                } catch (e) {
                    console.warn(`Analysis failed for puzzle ${i + 1}`, e);
                    setScanProgress(prev => ({ ...prev, current: prev.current + 1 }));
                }
                // Return a puzzle with an empty FEN on failure to still show an overlay
                return { boundingBox: tightBoxes[i], fen: '' };
            });

            const results = (await Promise.all(puzzlePromises)).filter(p => p !== null) as DetectedPuzzle[];
            setDetectedPuzzles(results);
            const validPuzzles = results.filter(p => p.fen).length;
            setScanProgress({ current: results.length, total: results.length, message: `Scan complete! Found ${validPuzzles} valid puzzle(s).` });
            setTimeout(() => setScanState('done'), 1000);

        } catch (error) {
            console.error('Deep scan failed:', error);
            setScanError(error instanceof Error ? error.message : 'An unknown error occurred during scan.');
            setScanState('error');
        }
    }, [imgSrc]);

    useEffect(() => {
        const reader = new FileReader();
        reader.onload = e => setImgSrc(e.target?.result as string);
        reader.readAsDataURL(imageFile);
    }, [imageFile]);

    useEffect(() => {
        if (imgSrc) {
            scanImage();
        }
    }, [imgSrc, scanImage]);
    
    const handlePuzzleClick = (puzzle: DetectedPuzzle) => {
        if (puzzle.fen) {
            onPuzzleSelect(puzzle.fen);
        } else {
            alert("This puzzle could not be analyzed. Please try a different image.");
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
                {scanState === 'scanning' && (
                    <div className="scan-overlay">
                        <div className="spinner" />
                        <p>{scanProgress.message}</p>
                        {scanProgress.total > 0 && <progress value={scanProgress.current} max={scanProgress.total} />}
                    </div>
                )}
                
                {scanState === 'done' && detectedPuzzles.length === 0 && (
                    <div className="scan-overlay">
                        <p>No chessboards were found in this image.</p>
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
                        <div 
                            key={index} 
                            className="puzzle-overlay" 
                            style={{ 
                                left: `${uiBox.x * 100}%`, 
                                top: `${uiBox.y * 100}%`, 
                                width: `${uiBox.width * 100}%`, 
                                height: `${uiBox.height * 100}%` 
                            }} 
                            onClick={() => handlePuzzleClick(puzzle)}
                            title={puzzle.fen ? "Click to analyze this puzzle" : "Analysis failed for this puzzle"}
                        >
                            <span className="corner-marker top-left"></span>
                            <span className="corner-marker top-right"></span>
                            <span className="corner-marker bottom-left"></span>
                            <span className="corner-marker bottom-right"></span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ImagePreview;