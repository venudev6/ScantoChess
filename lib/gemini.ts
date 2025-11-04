/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { Chess } from 'chess.js';
import { completeFen } from "./fenUtils";
import type { PieceColor, AnalysisDetails } from "./types";

/**
 * MOCK FUNCTION: Analyzes an image of the board's margins for turn markers (squares, triangles, etc.).
 * This simulates sending the image to a second backend server (Server 2) running a YOLOv8 neural network.
 * @param marginImage The image file of the area containing potential turn markers.
 * @returns A promise that resolves with the detected turn ('w' or 'b') or null if no marker is found.
 */
export const analyzeTurnMarker = async (
    marginImage: File
): Promise<{ turn: PieceColor | null }> => {
    console.debug("--- Server 2 (Mock) Turn Marker Analysis Started ---");
    // Simulate network delay for the neural network server.
    await new Promise(res => setTimeout(res, Math.random() * 800 + 400));
    
    // In a real implementation, you would send the `marginImage` to your
    // YOLOv8 server endpoint and parse its JSON response.
    
    // For this mock, we'll simulate a random response from the server based on the provided YAML file.
    const possibleDetections = ['black_triangle', 'white_triangle', 'black_square', 'white_square', null, null, null]; // Add nulls to reduce detection chance
    const detection = possibleDetections[Math.floor(Math.random() * possibleDetections.length)];

    if (!detection) {
        console.debug("--- Server 2 (Mock) Analysis Finished: No turn marker found. ---");
        return { turn: null };
    }

    // Parse the simulated output
    if (detection.startsWith('black')) {
        console.debug(`--- Server 2 (Mock) Analysis Finished: Detected a '${detection}' marker for Black's turn. ---`);
        return { turn: 'b' };
    } else if (detection.startsWith('white')) {
        console.debug(`--- Server 2 (Mock) Analysis Finished: Detected a '${detection}' marker for White's turn. ---`);
        return { turn: 'w' };
    }
    
    console.debug("--- Server 2 (Mock) Analysis Finished: Detection was inconclusive. ---");
    return { turn: null };
};


/**
 * Analyzes a chess position by sending the image to a backend server.
 * @param imageFile The image file of the chessboard.
 * @param isRetry A boolean to indicate if this is a rescan attempt.
 * @returns A promise that resolves with the analysis result from the server.
 */
export const analyzeImagePosition = async (
    imageFile: File,
    isRetry: boolean = false
): Promise<{ fen: string, turn: PieceColor, details: AnalysisDetails, timings: any, failureReason?: string }> => {
    console.debug("--- Server Analysis Pipeline Started ---", { imageName: imageFile.name, isRetry });
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
        
        console.debug("--- Server Analysis Pipeline Finished ---");
        
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
        console.error("Server analysis pipeline failed:", error);
        throw error; // Re-throw to be caught by the calling component (ProtectedApp.tsx)
    }
};