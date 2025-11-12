/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

// This file contains global configuration for the application.

/**
 * The Client ID for Google APIs (Sign-In and Drive).
 * This is the Web client ID from the Google Cloud Console for the Firebase project.
 */
export const GOOGLE_CLIENT_ID = '466929233043-2ve4u3lto416b0q3phmgg59948sgiss0.apps.googleusercontent.com';

/**
 * The scope for Google Drive API access.
 * drive allows the app to see, create, modify, and delete files it has permission to access.
 * This is required to create a visible folder in the user's "My Drive".
 */
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

// --- Client-Side Pipeline Configuration ---

/**
 * Confidence threshold below which a piece classification is considered "uncertain".
 * This is used to highlight squares on the result screen.
 */
export const MODEL_CONFIDENCE_THRESHOLD = 0.85;

/**
 * Confidence threshold below which the OCR result for the active turn is considered unreliable.
 * If confidence is below this, the UI will prompt the user to confirm the turn.
 */
export const OCR_TURN_CONFIDENCE_THRESHOLD = 0.70;

/**
 * The percentage of uncertain tiles (confidence < MODEL_CONFIDENCE_THRESHOLD)
 * that will trigger a scan to be considered a failure, prompting the user with fallback options.
 * E.g., 0.15 means if > 15% of pieces are uncertain, the scan fails.
 */
export const UNCERTAIN_TILES_PCT_FAIL = 0.15;