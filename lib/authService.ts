/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    GoogleAuthProvider,
    signInWithPopup,
    sendEmailVerification,
    onAuthStateChanged,
    updateProfile,
    User as FirebaseUser
} from 'firebase/auth';
import { auth } from './firebase';
import type { User } from './types';
import { GOOGLE_CLIENT_ID, GOOGLE_DRIVE_SCOPE } from './config';

/**
 * Maps a Firebase User object to the application's internal User type.
 * @param firebaseUser The user object from the Firebase Authentication SDK.
 * @returns The application-specific User object.
 */
const mapFirebaseUserToAppUser = (firebaseUser: FirebaseUser | null): User | null => {
    if (!firebaseUser) {
        return null;
    }
    // TODO: In a real app, 'role' would likely come from custom claims or a database (like Firestore).
    // For now, we default all users to the 'user' role.
    return {
        uid: firebaseUser.uid,
        email: firebaseUser.email!,
        name: firebaseUser.displayName || firebaseUser.email!.split('@')[0],
        photoUrl: firebaseUser.photoURL || undefined,
        role: 'user', 
        status: firebaseUser.emailVerified ? 'active' : 'pending',
    };
};

/**
 * A wrapper around Firebase's onAuthStateChanged.
 * It listens for changes in the user's sign-in state and calls the provided
 * callback with either the mapped application User object or null.
 * @param callback The function to call when the auth state changes.
 * @returns The unsubscribe function from Firebase.
 */
const onAuthUserChanged = (callback: (user: User | null) => void) => {
    return onAuthStateChanged(auth, (firebaseUser) => {
        const user = mapFirebaseUserToAppUser(firebaseUser);
        callback(user);
    });
};

/**
 * Logs out the current user.
 */
const logout = async () => {
    await signOut(auth);
};

/**
 * Attempts to log in a user with an email and password.
 */
const login = async (email: string, password: string): Promise<void> => {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    if (!userCredential.user.emailVerified) {
        // Send a new verification email to be helpful.
        await sendEmailVerification(userCredential.user);
        await logout(); // Sign out user if email is not verified
        throw new Error('Please verify your email address. A new verification email has been sent.');
    }
    // No return needed; onAuthStateChanged will handle the user object.
};

/**
 * Initiates the Google Sign-In popup flow.
 */
const loginWithGoogle = async (): Promise<{ token: string | null }> => {
    const provider = new GoogleAuthProvider();
    // Add the Google Drive scope to get an access token for the Drive API
    provider.addScope(GOOGLE_DRIVE_SCOPE);
    const result = await signInWithPopup(auth, provider);
    
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const token = credential?.accessToken || null;

    // No need to map/return the user; onAuthStateChanged will handle it.
    return { token };
};

/**
 * Checks whether the currently-signed-in Firebase user used Google as a provider.
 * If a Firebase SDK user is passed it will also be considered, but priority is given
 * to auth.currentUser to avoid mismatches with application-level User objects.
 */
const isGoogleUser = async (maybeUser?: FirebaseUser | null): Promise<boolean> => {
    // Prefer the real Firebase SDK user from the auth instance.
    const firebaseUser = auth.currentUser ?? (maybeUser ?? null);

    if (!firebaseUser) {
        return false;
    }

    const pd = (firebaseUser as any).providerData;

    if (!Array.isArray(pd)) {
        return false;
    }

    return pd.some((provider: any) => provider && provider.providerId === GoogleAuthProvider.PROVIDER_ID);
};


/**
 * Registers a new user with email and password, sends a verification email,
 * and then signs them out, requiring them to verify before logging in.
 */
const register = async (email: string, password: string): Promise<void> => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(userCredential.user);
    await signOut(auth); // Important: Sign out the user immediately.
};


/**
 * Retrieves the currently signed-in Firebase user and maps them to the app's User type.
 * Note: `onAuthUserChanged` is the preferred way to get the current user in real-time.
 */
const getCurrentUser = async (): Promise<User | null> => {
    // This is now synchronous as Firebase SDK caches the user state.
    return mapFirebaseUserToAppUser(auth.currentUser);
};

/**
 * (Admin Only) Fetches a list of all registered users.
 * NOTE: This functionality requires a backend with the Firebase Admin SDK.
 * This client-side implementation is a placeholder and will not work.
 */
const getAllUsers = async (): Promise<User[]> => {
    console.warn("getAllUsers requires a backend with Firebase Admin SDK and is not implemented on the client.");
    return Promise.resolve([]);
};

/**
 * Updates a user's profile information (name and photo).
 */
const updateUser = async (uid: string, updatedDetails: { name?: string; about?: string; photoUrl?: string }): Promise<User> => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser || firebaseUser.uid !== uid) {
        throw new Error("User not found or mismatch.");
    }
    
    await updateProfile(firebaseUser, {
        displayName: updatedDetails.name,
        photoURL: updatedDetails.photoUrl
    });

    // NOTE: The 'about' field cannot be saved with Firebase Auth alone.
    // This would require a database like Firestore to store extra profile data.
    if (updatedDetails.about !== undefined) {
         console.warn("'About me' field requires a database (like Firestore) and is not saved.");
    }
    
    return mapFirebaseUserToAppUser(auth.currentUser)!;
};

// --- Google Drive Service ---
export const googleDriveService = {
    async uploadFile(file: File, token: string): Promise<string> {
        // Find or create 'AAA Chess to Scan' folder
        const folderId = await this.findOrCreateFolder('AAA Chess to Scan', token);

        const metadata = {
            name: file.name,
            mimeType: file.type,
            parents: [folderId],
        };

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', file);

        const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
            },
            body: form,
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Google Drive upload failed: ${error.error.message}`);
        }

        const responseData = await response.json();
        return responseData.id;
    },

    async findOrCreateFolder(folderName: string, token: string): Promise<string> {
        // First, search for the folder
        let response = await fetch(`https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Failed to search for Google Drive folder: ${error.error.message}`);
        }
        
        let data = await response.json();
        if (data.files && data.files.length > 0) {
            return data.files[0].id;
        }

        // If not found, create it
        const metadata = {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
        };

        response = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(metadata),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Failed to create Google Drive folder: ${error.error.message}`);
        }
        
        data = await response.json();
        return data.id;
    }
};

// --- PIN Management (Not implemented with Firebase Auth) ---
// These functions would require a backend or Firestore to securely manage PINs.
const setPin = async (uid: string, pin: string): Promise<User> => { throw new Error("PIN functionality not implemented."); };
const verifyPin = async (uid: string, pin: string): Promise<boolean> => { throw new Error("PIN functionality not implemented."); };
const requestPinReset = async (uid: string): Promise<string> => { throw new Error("PIN functionality not implemented."); };
const resetPin = async (token: string, newPin: string): Promise<User> => { throw new Error("PIN functionality not implemented."); };

// --- Exported Auth Service Object ---
export const authService = {
    login,
    loginWithGoogle,
    isGoogleUser,
    register,
    logout,
    getCurrentUser,
    getAllUsers,
    updateUser,
    setPin,
    verifyPin,
    requestPinReset,
    resetPin,
};

// Export the listener separately
export { onAuthUserChanged };