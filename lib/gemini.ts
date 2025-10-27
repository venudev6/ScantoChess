/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { Chess } from 'chess.js';
import { completeFen } from "./fenUtils";
import type { PieceColor, AnalysisDetails, BoundingBox } from "./types";

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
        
        // This is the key change.
        // We construct the details object by merging data from multiple potential sources in the server response.
        // This ensures that even if `data.details` is present, we still correctly add `warpedImageDataUrl` if `data.warped_image_b64` exists.
        const details: AnalysisDetails = {
            // Start with any existing details object from the server to not lose data.
            ...(data.details || {}),
            // Then, explicitly override or add properties from the top level of the response for robustness.
            confidence: data.confidence ?? data.details?.confidence ?? null,
            reasoning: data.reasoning ?? data.details?.reasoning ?? "Position analyzed by backend server.",
            uncertainSquares: data.uncertain_squares ?? data.details?.uncertainSquares ?? [],
            postProcess: data.post_process ?? data.details?.postProcess,
            individualScans: data.individual_scans ?? data.details?.individualScans,
            meta: data.meta ?? data.details?.meta,
            // Prefer the top-level b64 image, but fall back to one inside details if it exists.
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

/**
 * MOCK IMPLEMENTATION - This function is a placeholder.
 * The original client-side board detection was moved to a backend service,
 * but the endpoint for multi-board detection is not specified.
 * This will currently return no boards.
 * @param imageBase64 The base64 encoded image of a page.
 * @returns A promise that resolves with an array of detected bounding boxes.
 */
export const findChessboardsInPage = async (imageBase64: string): Promise<BoundingBox[]> => {
    console.warn('findChessboardsInPage is a mock implementation and will not find any boards.');
    // In a real implementation, this would make a fetch call to a backend endpoint like:
    // const response = await fetch('/api/detect-boards', { ... });
    // const data = await response.json();
    // return data.boundingBoxes;
    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
    return [];
};