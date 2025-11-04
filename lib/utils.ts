/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

// @ts-ignore
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import { fenToBoardState } from './fenUtils';
import { UNICODE_PIECES } from './chessConstants';
import type { PieceColor, HistoryEntry, BoundingBox } from './types';
import { analyzeTurnMarker } from './gemini';

// Keep the same global declarations used elsewhere.
declare global {
    interface Window {
        cv: any;
        cvReady: Promise<void>;
        onOpenCvReady: () => void;
    }
}

declare const Tesseract: any;

/**
 * Expands a bounding box by a given percentage in all directions, clamping to the 0-1 range.
 * @param box The original bounding box with x, y, width, height as percentages (0-1).
 * @param percent The percentage to expand by (e.g., 0.01 for 1%).
 * @returns The new, expanded bounding box.
 */
export const expandBox = (box: BoundingBox, percent: number): BoundingBox => {
    const newX = Math.max(0, box.x - percent);
    const newY = Math.max(0, box.y - percent);
    const newWidth = Math.min(1 - newX, box.width + (percent * 2));
    const newHeight = Math.min(1 - newY, box.height + (percent * 2));
    return { x: newX, y: newY, width: newWidth, height: newHeight };
};

/* ---------- helper functions (unchanged) ---------- */

export const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error('Failed to read file as data URL.'));
            }
        };
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
};

export const fileToImage = (file: File): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(img);
        };
        img.onerror = (error) => {
            URL.revokeObjectURL(objectUrl);
            reject(error);
        };
        img.src = objectUrl;
    });
};

export const imageToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const base64 = reader.result.split(',')[1];
        if (base64) {
          resolve(base64);
        } else {
          reject(new Error('Failed to extract base64 from data URL.'));
        }
      } else {
        reject(new Error('Failed to read file as base64 string.'));
      }
    };
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
};

export const resizeAndExportImage = (
    canvas: HTMLCanvasElement,
    options: {
        maxDimension: number,
        type: 'image/webp' | 'image/jpeg' | 'image/png',
        quality: number,
        fileName: string
    }
): Promise<File | null> => {
    return new Promise((resolve) => {
        const { maxDimension, type, quality, fileName } = options;
        const { width: originalWidth, height: originalHeight } = canvas;

        let targetWidth = originalWidth;
        let targetHeight = originalHeight;

        if (targetWidth > maxDimension || targetHeight > maxDimension) {
            if (targetWidth > targetHeight) {
                targetHeight = Math.round((targetHeight / targetWidth) * maxDimension);
                targetWidth = maxDimension;
            } else {
                targetWidth = Math.round((targetWidth / targetHeight) * maxDimension);
                targetHeight = maxDimension;
            }
        }

        const resizeCanvas = document.createElement('canvas');
        resizeCanvas.width = targetWidth;
        resizeCanvas.height = targetHeight;
        const ctx = resizeCanvas.getContext('2d');

        if (!ctx) {
            resolve(null);
            return;
        }

        ctx.drawImage(canvas, 0, 0, originalWidth, originalHeight, 0, 0, targetWidth, targetHeight);

        resizeCanvas.toBlob(
            (blob) => {
                if (!blob) {
                    resolve(null);
                    return;
                }
                resolve(new File([blob], fileName, { type }));
            },
            type,
            quality
        );
    });
};

export const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        try {
            const parts = dataUrl.split(',');
            if (parts.length !== 2) {
                throw new Error('Invalid data URL format');
            }
            const meta = parts[0];
            const base64Data = parts[1];

            const mimeMatch = meta.match(/:(.*?);/);
            if (!mimeMatch || mimeMatch.length < 2) {
                throw new Error('Could not parse MIME type');
            }
            const mimeType = mimeMatch[1];
            
            const binaryString = atob(base64Data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            resolve(new Blob([bytes], { type: mimeType }));
        } catch (e) {
            console.error("Failed to convert data URL to blob", e);
            reject(new Error("Failed to convert data URL to blob."));
        }
    });
};

export const dataUrlToFile = async (dataUrl: string, fileName: string): Promise<File> => {
    const blob = await dataUrlToBlob(dataUrl);
    return new File([blob], fileName, { type: blob.type });
};

/* ---------- PDF thumbnail generator (fixed to use dynamic worker) ---------- */

/**
 * Generates a thumbnail image from the first page of a PDF file.
 * Uses pdfjs-dist runtime version to set worker URL dynamically.
 */
export const generatePdfThumbnail = async (file: File, pageNum = 1): Promise<string> => {
    const runtimeVersion = (pdfjsLib as any)?.version || (pdfjsLib as any)?.pdfjsVersion || '4.10.38';
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://aistudiocdn.com/pdfjs-dist@${runtimeVersion}/build/pdf.worker.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const doc = await loadingTask.promise;
    const page = await doc.getPage(pageNum);

    const viewport = page.getViewport({ scale: 0.5 });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');

    if (context) {
        await page.render({ canvasContext: context, viewport }).promise;
    }

    try { page.cleanup(); } catch (e) { /* ignore */ }
    try { doc.destroy(); } catch (e) { /* ignore */ }

    return canvas.toDataURL('image/jpeg', 0.8);
};

/* ---------- remaining helpers (unchanged) ---------- */

export const generateBoardThumbnail = (fen: string): string => {
    try {
        const { board } = fenToBoardState(fen);
        const size = 200;
        const squareSize = size / 8;
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`;

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const isLight = (r + c) % 2 !== 0;
                svg += `<rect x="${c * squareSize}" y="${r * squareSize}" width="${squareSize}" height="${squareSize}" fill="${isLight ? '#f0d9b5' : '#b58863'}" />`;
            }
        }

        board.forEach((row, r) => {
            row.forEach((piece, c) => {
                if (piece) {
                    const unicode = UNICODE_PIECES[piece.color][piece.type];
                    const pieceColor = piece.color === 'w' ? '#fff' : '#000';
                    const strokeColor = piece.color === 'w' ? '#000' : '#fff';
                    svg += `<text x="${c * squareSize + squareSize / 2}" y="${r * squareSize + squareSize / 2}" font-size="${squareSize * 0.8}" text-anchor="middle" dominant-baseline="central" fill="${pieceColor}" stroke="${strokeColor}" stroke-width="1" style="paint-order: stroke;">${unicode}</text>`;
                }
            });
        });

        svg += '</svg>';
        const base64Svg = btoa(unescape(encodeURIComponent(svg)));
        return `data:image/svg+xml;base64,${base64Svg}`;
    } catch (e) {
        console.error("Failed to generate board thumbnail for FEN:", fen, e);
        return "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    }
};

export const generateBoardImageForSharing = (fen: string): string => {
    try {
        const { board } = fenToBoardState(fen);
        const size = 800;
        const squareSize = size / 8;
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" font-family="Arial, sans-serif">`;

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const isLight = (r + c) % 2 !== 0;
                svg += `<rect x="${c * squareSize}" y="${r * squareSize}" width="${squareSize}" height="${squareSize}" fill="${isLight ? '#f0d9b5' : '#b58863'}" />`;
            }
        }

        board.forEach((row, r) => {
            row.forEach((piece, c) => {
                if (piece) {
                    const unicode = UNICODE_PIECES[piece.color][piece.type];
                    const pieceColor = piece.color === 'w' ? '#fff' : '#000';
                    const strokeColor = piece.color === 'w' ? '#000' : '#fff';
                    svg += `<text x="${c * squareSize + squareSize / 2}" y="${r * squareSize + squareSize / 2}" font-size="${squareSize * 0.85}" text-anchor="middle" dominant-baseline="central" fill="${pieceColor}" stroke="${strokeColor}" stroke-width="1.5" style="paint-order: stroke;">${unicode}</text>`;
                }
            });
        });

        svg += '</svg>';
        const base64Svg = btoa(unescape(encodeURIComponent(svg)));
        return `data:image/svg+xml;base64,${base64Svg}`;
    } catch (e) {
        console.error("Failed to generate board image for FEN:", fen, e);
        return "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    }
};

export const computeImageHash = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
  return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');
};

export const sanToSymbolic = (san: string | null, color: PieceColor): string => {
    if (!san) return '';
    const pieceMatch = san.match(/^[KQRBN]/);
    if (pieceMatch) {
        const piece = pieceMatch[0].toLowerCase() as keyof typeof UNICODE_PIECES['w'];
        return UNICODE_PIECES[color][piece] + san.substring(1);
    }
    return san;
};

export const findPathToNode = (root: HistoryEntry, nodeId: string): HistoryEntry[] | null => {
    const path: HistoryEntry[] = [];
    function find(node: HistoryEntry): boolean {
        path.push(node);
        if (node.id === nodeId) {
            return true;
        }
        if (node.children) {
            for (const child of node.children) {
                if (find(child)) {
                    return true;
                }
            }
        }
        path.pop();
        return false;
    }

    if (find(root)) {
        return path;
    }
    return null;
};

const detectTurnWithOCR = async (imageFile: File): Promise<PieceColor | null> => {
    try {
        if (typeof Tesseract === 'undefined') {
            console.warn('Tesseract.js is not loaded. Skipping OCR turn detection.');
            return null;
        }
        const worker = await Tesseract.createWorker('eng');
        const { data: { text } } = await worker.recognize(imageFile);
        await worker.terminate();

        const lowerText = text.toLowerCase().replace(/[^a-z\s]/g, '');
        
        if (lowerText.includes('white to move') || lowerText.includes('white to play')) {
            return 'w';
        }
        if (lowerText.includes('black to move') || lowerText.includes('black to play')) {
            return 'b';
        }
        return null;
    } catch (err) {
        console.error("Tesseract OCR for turn detection failed:", err);
        return null;
    }
};

/**
 * New: Uses OpenCV to find candidate marker shapes, squares them up, and sends them to Server 2.
 * @param imageFile The full cropped image (board + margins).
 * @returns The detected turn ('w' or 'b') or null.
 */
const findAndAnalyzeTurnMarkersCV = async (imageFile: File): Promise<PieceColor | null> => {
    await window.cvReady;
    const cv = window.cv;
    const mats: any[] = [];
    try {
        const imgElement = await fileToImage(imageFile);
        const src = cv.imread(imgElement);
        mats.push(src);

        const gray = new cv.Mat();
        mats.push(gray);
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

        const thresh = new cv.Mat();
        mats.push(thresh);
        cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
        
        const contours = new cv.MatVector();
        mats.push(contours);
        const hierarchy = new cv.Mat();
        mats.push(hierarchy);
        cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        const marginWidth = src.cols * 0.15; // Search in the outer 15% margins
        const minArea = 50; // Minimum pixel area to be considered a shape
        const maxArea = src.cols * src.rows * 0.01; // Max 1% of total image area

        for (let i = 0; i < contours.size(); ++i) {
            const cnt = contours.get(i);
            const rect = cv.boundingRect(cnt);
            
            // Filter criteria
            const isShapeInMargin = rect.x < marginWidth || rect.x + rect.width > src.cols - marginWidth;
            const isShapeGoodSize = rect.width * rect.height > minArea && rect.width * rect.height < maxArea;
            const aspectRatio = rect.width / rect.height;
            const isShapeSquarish = aspectRatio > 0.7 && aspectRatio < 1.3;

            if (isShapeInMargin && isShapeGoodSize && isShapeSquarish) {
                // We found a candidate. Crop it from the original color image.
                const cropped = src.roi(rect);
                
                // "Square-up" the cropped image for the YOLO model
                const size = Math.max(cropped.rows, cropped.cols);
                const squareMat = new cv.Mat(size, size, cropped.type(), [255, 255, 255, 255]); // White background
                const xOffset = Math.floor((size - cropped.cols) / 2);
                const yOffset = Math.floor((size - cropped.rows) / 2);
                const roi = squareMat.roi(new cv.Rect(xOffset, yOffset, cropped.cols, cropped.rows));
                cropped.copyTo(roi);

                // Convert the squared-up Mat to a File to send to the mock server
                const tempCanvas = document.createElement('canvas');
                cv.imshow(tempCanvas, squareMat);
                const blob = await new Promise<Blob|null>(resolve => tempCanvas.toBlob(resolve, 'image/png'));
                
                // Cleanup temp mats for this loop iteration
                cropped.delete();
                squareMat.delete();
                roi.delete();

                if (blob) {
                    const markerFile = new File([blob], 'turn_marker.png', { type: 'image/png' });
                    const { turn } = await analyzeTurnMarker(markerFile);
                    if (turn) {
                        cnt.delete();
                        return turn; // Found a valid turn, exit early.
                    }
                }
            }
            cnt.delete();
        }
        return null; // No valid turn marker found after checking all contours.
    } catch(e) {
        console.error("OpenCV shape detection failed:", e);
        return null;
    } finally {
        // Ensure all mats are deleted to prevent memory leaks
        mats.forEach(mat => {
            if (mat && !mat.isDeleted()) mat.delete();
        });
    }
};


export const determineTurnFromImage = async (imageFile: File): Promise<{turn: PieceColor, ocr_turn_detection_ms: number | null, shape_turn_detection_ms: number | null }> => {
    let ocr_turn_detection_ms: number | null = null;
    let shape_turn_detection_ms: number | null = null;
    
    // Priority 1: OCR for text ("White to play", etc.)
    const ocrStartTime = performance.now();
    const ocrResult = await detectTurnWithOCR(imageFile);
    ocr_turn_detection_ms = performance.now() - ocrStartTime;
    
    if (ocrResult) {
        console.log(`Client-side turn detection: Found text '${ocrResult}' via OCR.`);
        return { turn: ocrResult, ocr_turn_detection_ms, shape_turn_detection_ms };
    }

    // Priority 2: OpenCV + Server 2 for shape markers (squares, triangles, etc.)
    const shapeStartTime = performance.now();
    const shapeResult = await findAndAnalyzeTurnMarkersCV(imageFile);
    shape_turn_detection_ms = performance.now() - shapeStartTime;

    if (shapeResult) {
        console.log(`Client-side turn detection: Found shape marker for '${shapeResult}' via OpenCV + Server 2.`);
        return { turn: shapeResult, ocr_turn_detection_ms, shape_turn_detection_ms };
    }
    
    // Priority 3: Default to White if nothing is found
    console.log("Client-side turn detection: No markers found. Defaulting to White's turn.");
    return { turn: 'w', ocr_turn_detection_ms, shape_turn_detection_ms };
};

export const calculateIoU = (boxA: BoundingBox, boxB: BoundingBox): number => {
    const xA = Math.max(boxA.x, boxB.x);
    const yA = Math.max(boxA.y, boxB.y);
    const xB = Math.min(boxA.x + boxA.width, boxB.x + boxB.width);
    const yB = Math.min(boxA.y + boxA.height, boxB.y + boxB.height);

    const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    const boxAArea = boxA.width * boxA.height;
    const boxBArea = boxB.width * boxB.height;
    const unionArea = boxAArea + boxBArea - interArea;

    return unionArea > 0 ? interArea / unionArea : 0;
};

export const detectChessboardsCV = async (canvas: HTMLCanvasElement): Promise<BoundingBox[]> => {
    await window.cvReady;
    const cv = window.cv;
    const mats: any[] = [];
    try {
        const src = cv.imread(canvas);
        mats.push(src);

        const gray = new cv.Mat();
        mats.push(gray);
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

        const blurred = new cv.Mat();
        mats.push(blurred);
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

        const canny = new cv.Mat();
        mats.push(canny);
        cv.Canny(blurred, canny, 50, 150, 3, false);

        const contours = new cv.MatVector();
        mats.push(contours);
        const hierarchy = new cv.Mat();
        mats.push(hierarchy);
        cv.findContours(canny, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        const detectedBoxes: BoundingBox[] = [];
        const minArea = (src.cols * src.rows) * 0.01;

        for (let i = 0; i < contours.size(); ++i) {
            const cnt = contours.get(i);
            const peri = cv.arcLength(cnt, true);
            const approx = new cv.Mat();
            cv.approxPolyDP(cnt, approx, 0.04 * peri, true);

            if (approx.rows === 4) {
                const area = cv.contourArea(approx);
                const rect = cv.boundingRect(approx);
                const aspectRatio = rect.width / rect.height;

                if (area > minArea && aspectRatio > 0.8 && aspectRatio < 1.2) {
                    detectedBoxes.push({
                        x: rect.x / src.cols,
                        y: rect.y / src.rows,
                        width: rect.width / src.cols,
                        height: rect.height / src.rows,
                    });
                }
            }
            cnt.delete();
            approx.delete();
        }

        detectedBoxes.sort((a, b) => (b.width * b.height) - (a.width * a.height));
        const finalBoxes: BoundingBox[] = [];
        const iouThreshold = 0.5;

        for (const boxA of detectedBoxes) {
            let keep = true;
            for (const boxB of finalBoxes) {
                const iou = calculateIoU(boxA, boxB);
                if (iou > iouThreshold) {
                    keep = false;
                    break;
                }
            }
            if (keep) {
                finalBoxes.push(boxA);
            }
        }
        
        return finalBoxes;
    } finally {
        mats.forEach(mat => {
            if (mat && !mat.isDeleted()) mat.delete();
        });
    }
};