/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { Chess } from 'chess.js';
import { completeFen } from "./fenUtils";
import type { PieceColor, AnalysisDetails } from "./types";
import { imageToBase64 } from './utils';

/**
 * MOCK FUNCTION: Analyzes an image of the board's margins for turn markers (squares, triangles, etc.).
 * This simulates sending the image to a second backend server (Server 2) running a YOLOv8 neural network.
 * @param marginImage The image file of the area containing potential turn markers.
 * @returns A promise that resolves with the detected turn ('w' or 'b') or null if no marker is found.
 */
export const analyzeTurnMarker = async (
    markerImage: File,
): Promise<{ turn: PieceColor | null; yoloResponse: any; yoloRequestPayload: { image: string } | null }> => {
    console.debug("--- Server 2 (YOLOv8) Turn Marker Analysis Started ---");

    try {
        // The image is already pre-processed and resized by findAndAnalyzeTurnMarkersCV
        const base64Image = await imageToBase64(markerImage);
        const requestPayload = { image: base64Image };

        const response = await fetch('https://server-nandan-yolov8-466929233043.asia-south1.run.app/predict', {
            method: 'POST',
            mode: 'cors', // Explicitly set the mode to handle cross-origin requests
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify(requestPayload),
        });

        if (!response.ok) {
            if (response.type === 'opaque') {
                throw new Error('Received an opaque response, which often indicates a CORS configuration issue on the server.');
            }
            const errorText = await response.text();
            throw new Error(`YOLOv8 server error: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        console.debug("--- Server 2 (YOLOv8) Response: ", data);

        if (data.detections && data.detections.length > 0) {
            // Find the detection with the highest confidence
            const bestDetection = data.detections.reduce((best: any, current: any) => {
                return current.confidence > best.confidence ? current : best;
            }, data.detections[0]);

            const className = bestDetection.class_name;
            
            if (className) {
                if (className.startsWith('black')) {
                    console.debug(`--- Server 2 (YOLOv8) Analysis Finished: Detected a '${className}' marker for Black's turn.`);                   
                    return { turn: 'b', yoloResponse: data, yoloRequestPayload: requestPayload };
                } else if (className.startsWith('white')) {
                    console.debug(`--- Server 2 (YOLOv8) Analysis Finished: Detected a '${className}' marker for White's turn.`);
                    return { turn: 'w', yoloResponse: data, yoloRequestPayload: requestPayload };
                }
            }
        }
        
        console.debug("--- Server 2 (YOLOv8) Analysis Finished: No conclusive turn marker found. ---");
        return { turn: null, yoloResponse: data, yoloRequestPayload: requestPayload };

    } catch (error) {
        console.error("Error calling YOLOv8 turn marker analysis server:", error);
        throw error;
    }
};


/**
 * Analyzes a chess position by sending the image to the custom FEN analysis server.
 * @param imageFile The image file of the chessboard.
 * @param isRetry A boolean to indicate if this is a rescan attempt.
 * @returns A promise that resolves with the analysis result from the server.
 */
export const analyzePosition = async (
    imageFile: File,
    isRetry: boolean = false
): Promise<{ fen: string, turn: PieceColor, details: AnalysisDetails, timings: any, failureReason?: string }> => {
    console.debug("--- FEN Server Analysis Pipeline Started ---", { imageName: imageFile.name, isRetry });
    const startTime = performance.now();
    const timings: any = {};

    try {
        const formData = new FormData();
        formData.append('image', imageFile);
        
        // This endpoint points to the user's deployed backend server.
        const response = await fetch('https://server-nandan-backend-466929233043.asia-south1.run.app/api/scan-chess', {
            method: 'POST',
            body: formData,
        });

        const duration = performance.now() - startTime;
        timings.total_scan_ms = duration;

        if (!response.ok) {
            let serverError = 'Server returned an error.';
            try {
                // Try to parse a JSON error message from the server
                const errorJson = await response.json();
                serverError = errorJson.error || `Server error: ${response.status} ${response.statusText}`;
            } catch (e) {
                // If the response isn't JSON, use the status text
                serverError = `Server error: ${response.status} ${response.statusText}`;
            }
            throw new Error(serverError);
        }

        const data = await response.json();

        if (!data.fen || typeof data.fen !== 'string') {
            throw new Error("Server response did not include a valid 'fen' string.");
        }
        
        const completedFen = completeFen(data.fen);
        let failureReason: string | undefined = data.failure_reason;
        let turnColor: PieceColor = 'w';

        try { 
            const game = new Chess(completedFen);
            turnColor = game.turn() as PieceColor;
            console.debug("Server FEN is valid according to chess.js.");
        } catch (e) { 
            const chessJsError = `chessjs_validation_failed: ${e instanceof Error ? e.message : String(e)}`;
            failureReason = failureReason ? `${failureReason}. ${chessJsError}` : chessJsError;
            console.error("Server FEN is INVALID.", { fen: completedFen, error: failureReason });
            // Attempt to parse turn from the invalid FEN string itself.
            const parts = completedFen.split(' ');
            if (parts[1] === 'b') {
                turnColor = 'b';
            }
        }
        
        console.debug("--- FEN Server Analysis Pipeline Finished ---");
        
        const details: AnalysisDetails = {
            ...(data.details || {}),
            confidence: data.confidence ?? data.details?.confidence ?? null,
            reasoning: data.reasoning ?? data.details?.reasoning ?? "Position analyzed by backend server.",
            uncertainSquares: data.uncertain_squares ?? data.details?.uncertainSquares ?? [],
            postProcess: data.post_process ?? data.details?.postProcess,
            individualScans: data.individual_scans ?? data.details?.individualScans,
            meta: data.meta ?? data.details?.meta,
            warpedImageDataUrl: data.warped_image_b64 ? `data:image/png;base64,${data.warped_image_b64}` : (data.details?.warpedImageDataUrl || undefined),
            failureReason: data.failure_reason ?? data.details?.failureReason,
        };

        return {
            fen: completedFen,
            turn: turnColor,
            details,
            timings: data.timings || { total_scan_ms: duration },
            failureReason
        };

    } catch (error) {
        console.error("FEN Server analysis pipeline failed:", error);
        throw error; // Re-throw to be caught by the calling component (ProtectedApp.tsx)
    }
};