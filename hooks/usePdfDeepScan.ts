/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useState, useCallback, useRef } from 'react';
import type * as pdfjsLib from "pdfjs-dist";
import { analyzeImagePosition } from '../lib/gemini';
import { db } from '../lib/db';
import type { DetectedPuzzle, BoundingBox } from '../lib/types';
import { detectChessboardsCV, determineTurnFromImage } from '../lib/utils';


// Helper to render a page to a canvas, which we still need to get the image data.
const renderPageToCanvas = async (page: pdfjsLib.PDFPageProxy): Promise<HTMLCanvasElement> => {
    const viewport = page.getViewport({ scale: 2.0 }); // Use high resolution for better detection
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');
    if (context) {
        // Render with a white background to handle transparent PDFs
        context.fillStyle = '#FFFFFF';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport } as any).promise;
    }
    return canvas;
};

export const usePdfDeepScan = (pdfDoc: pdfjsLib.PDFDocumentProxy | null, pdfId: number) => {
    const [isDeepScanning, setIsDeepScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState({ current: 0, total: 0, message: '' });
    const isCancelledRef = useRef(false);

    const cancelDeepScan = useCallback(() => {
        isCancelledRef.current = true;
        setIsDeepScanning(false); // Immediately update UI
    }, []);

    const startDeepScan = useCallback(async (pageNum: number, onScanComplete: (puzzles: DetectedPuzzle[]) => void) => {
        if (!pdfDoc || isDeepScanning) return;

        setIsDeepScanning(true);
        isCancelledRef.current = false;
        setScanProgress({ current: 0, total: 0, message: 'Detecting chessboards...' });

        let page: pdfjsLib.PDFPageProxy | null = null;
        try {
            page = await pdfDoc.getPage(pageNum);
            const pageCanvas = await renderPageToCanvas(page);
            if (isCancelledRef.current) { page.cleanup(); return; }

            const tightBoxes = await detectChessboardsCV(pageCanvas);
            if (isCancelledRef.current) { page.cleanup(); return; }
            
            if (tightBoxes.length === 0) {
                setScanProgress({ current: 0, total: 0, message: 'No chessboards found.' });
                await db.savePdfPuzzles({ pdfId, page: pageNum, puzzles: [] });
                setTimeout(() => onScanComplete([]), 1500);
                return;
            }
            
            // Expand bounding boxes by 4% for analysis, but keep the original tight boxes for storage.
            const PADDING_PERCENT = 0.04; 
            const expandedBoxes = tightBoxes.map(box => {
                const newX = Math.max(0, box.x - PADDING_PERCENT);
                const newY = Math.max(0, box.y - PADDING_PERCENT);
                const newWidth = Math.min(1 - newX, box.width + (PADDING_PERCENT * 2));
                const newHeight = Math.min(1 - newY, box.height + (PADDING_PERCENT * 2));
                return { x: newX, y: newY, width: newWidth, height: newHeight };
            });

            setScanProgress({ current: 0, total: expandedBoxes.length, message: `Found ${expandedBoxes.length} potential puzzles. Analyzing...` });
            
            const puzzlePromises = expandedBoxes.map(async (expandedBox, i) => {
                if (isCancelledRef.current) return null;

                const croppedCanvas = document.createElement('canvas');
                croppedCanvas.width = expandedBox.width * pageCanvas.width;
                croppedCanvas.height = expandedBox.height * pageCanvas.height;
                const ctx = croppedCanvas.getContext('2d');
                ctx?.drawImage(pageCanvas, expandedBox.x * pageCanvas.width, expandedBox.y * pageCanvas.height, croppedCanvas.width, croppedCanvas.height, 0, 0, croppedCanvas.width, croppedCanvas.height);

                const blob = await new Promise<Blob | null>(resolve => croppedCanvas.toBlob(resolve, 'image/webp', 0.8));
                if (!blob) return { boundingBox: tightBoxes[i], fen: '' };

                const puzzleFile = new File([blob], `puzzle_${pageNum}_${i}.webp`, { type: 'image/webp' });
                
                try {
                    // Run FEN detection (Server 1) and Turn detection (OCR + Server 2) in parallel
                    const [fenResult, turnResult] = await Promise.all([
                        analyzeImagePosition(puzzleFile),
                        determineTurnFromImage(puzzleFile)
                    ]);

                    if (isCancelledRef.current) return null;

                    // Update progress inside the promise resolution
                    setScanProgress(prev => ({ ...prev, current: prev.current + 1, message: `Analyzing puzzle ${prev.current + 1} of ${expandedBoxes.length}...` }));

                    if (fenResult.fen && !fenResult.failureReason) {
                        const { turn: clientTurn } = turnResult;
                        const fenParts = fenResult.fen.split(' ');
                        const serverTurn = fenParts.length > 1 ? fenParts[1] : 'w';
                        fenParts[1] = clientTurn;
                        const correctedFen = fenParts.join(' ');
                        
                        console.log(`Deep Scan (Page ${pageNum}, Puzzle ${i+1}) Turn: Server indicated '${serverTurn}', Client detected '${clientTurn}'. Using client's result.`);

                        return { boundingBox: tightBoxes[i], fen: correctedFen };
                    }
                } catch (e) {
                    console.warn(`Analysis failed for puzzle ${i+1} on page ${pageNum}`, e);
                    setScanProgress(prev => ({ ...prev, current: prev.current + 1 }));
                }
                return { boundingBox: tightBoxes[i], fen: '' }; // Return placeholder on failure
            });

            const allPuzzles = (await Promise.all(puzzlePromises)).filter(p => p !== null) as DetectedPuzzle[];
            
            if (isCancelledRef.current) return;

            await db.savePdfPuzzles({ pdfId, page: pageNum, puzzles: allPuzzles });
            const validPuzzlesCount = allPuzzles.filter(p => p.fen).length;
            setScanProgress({ current: allPuzzles.length, total: allPuzzles.length, message: `Scan complete! Found ${validPuzzlesCount} valid puzzles.` });
            
            setTimeout(() => onScanComplete(allPuzzles), 1500);

        } catch (error) {
            console.error(`Failed to scan page ${pageNum}:`, error);
            setScanProgress({ current: 0, total: 0, message: `An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}` });
        } finally {
            page?.cleanup();
            if (!isCancelledRef.current) {
                setTimeout(() => setIsDeepScanning(false), 2000);
            }
        }
    }, [pdfDoc, pdfId, isDeepScanning]);

    return {
        isDeepScanning,
        scanProgress,
        startDeepScan,
        cancelDeepScan,
    };
};