/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { createContext, useState, useContext, useEffect, ReactNode, PropsWithChildren, useCallback } from 'react';
import { authService, onAuthUserChanged } from '../lib/authService';
import { GOOGLE_CLIENT_ID, GOOGLE_DRIVE_SCOPE } from '../lib/config';
import type { User } from '../lib/types';

declare var google: any;

interface AuthContextType {
    user: User | null;
    isLoggedIn: boolean;
    isLoading: boolean;
    login: (email: string, pass: string) => Promise<void>;
    loginWithGoogle: () => Promise<void>;
    register: (email: string, pass: string) => Promise<void>;
    logout: () => void;
    updateUser: (updatedDetails: { name?: string, about?: string, photoUrl?: string }) => Promise<User>;
    authFlowVisible: boolean;
    requestAuthFlow: () => void;
    hideAuthFlow: () => void;
    driveAccessToken: string | null;
    authorizeDrive: () => void;
    setPin: (pin: string) => Promise<User>;
    verifyPin: (pin: string) => Promise<boolean>;
    requestPinReset: () => Promise<string>;
    resetPin: (token: string, newPin: string) => Promise<User>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);


export const AuthProvider = ({ children }: PropsWithChildren) => {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [authFlowVisible, setAuthFlowVisible] = useState(false);
    const [driveAccessToken, setDriveAccessToken] = useState<string | null>(null);
    const [tokenClient, setTokenClient] = useState<any>(null);

    const hideAuthFlow = useCallback(() => {
        setAuthFlowVisible(false);
    }, []);

    useEffect(() => {
        // Subscribe to Firebase's auth state changes.
        // This is the single source of truth for the user's login state.
        const unsubscribe = onAuthUserChanged((user) => {
            setUser(user);
            setIsLoading(false);
            if (user) {
                // When a user successfully logs in, hide any visible auth modals.
                hideAuthFlow();
            }
        });

        // Cleanup subscription on unmount
        return () => unsubscribe();
    }, [hideAuthFlow]);
    
    useEffect(() => {
        // This check ensures we don't crash if the google scripts fail to load.
        // This logic is for Google Drive, not auth, so it remains.
        const initializeGapi = () => {
            if (typeof google !== 'undefined' && google.accounts) {
                const client = google.accounts.oauth2.initTokenClient({
                    client_id: GOOGLE_CLIENT_ID,
                    scope: GOOGLE_DRIVE_SCOPE,
                    callback: (tokenResponse: any) => {
                        if (tokenResponse && tokenResponse.access_token) {
                            setDriveAccessToken(tokenResponse.access_token);
                        }
                    },
                });
                setTokenClient(client);
            }
        }
        // The GSI script is loaded asynchronously, so we poll for it.
        const intervalId = setInterval(() => {
            if (typeof google !== 'undefined' && google.accounts) {
                initializeGapi();
                clearInterval(intervalId);
            }
        }, 100);

        return () => clearInterval(intervalId);
    }, []);

    const login = async (email: string, pass: string) => {
        await authService.login(email, pass);
        // The onAuthStateChanged listener will handle the UI updates.
    };

    const loginWithGoogle = async () => {
        const { token } = await authService.loginWithGoogle();
        // The onAuthStateChanged listener will set the user.
        // We still need to handle the token here.
        setDriveAccessToken(token);
    };

    const register = async (email: string, pass: string) => {
        await authService.register(email, pass);
        // The UI will handle showing a success message.
    };

    const logout = async () => {
        await authService.logout();
        // onAuthStateChanged will set user to null.
        setAuthFlowVisible(false);
        setDriveAccessToken(null);
    };

    const authorizeDrive = () => {
        if (tokenClient) {
            tokenClient.requestAccessToken();
        } else {
            console.error("Google API client not initialized. Cannot authorize Drive.");
        }
    };

    const updateUser = async (updatedDetails: { name?: string; about?: string; photoUrl?: string }): Promise<User> => {
        if (!user) {
            throw new Error("Cannot update profile when not logged in.");
        }
        const updatedUser = await authService.updateUser(user.uid, updatedDetails);
        setUser(updatedUser); // Manually update local user state for immediate UI feedback
        return updatedUser;
    };

    const setPin = async (pin: string) => {
        if (!user) throw new Error("Not logged in");
        return authService.setPin(user.uid, pin);
    };

    const verifyPin = async (pin: string) => {
        if (!user) throw new Error("Not logged in");
        return authService.verifyPin(user.uid, pin);
    };

    const requestPinReset = async () => {
        if (!user) throw new Error("Not logged in");
        return authService.requestPinReset(user.uid);
    };

    const resetPin = async (token: string, newPin: string) => {
        if (!user) throw new Error("Not logged in");
        return authService.resetPin(token, newPin);
    };
    
    const requestAuthFlow = useCallback(() => {
        setAuthFlowVisible(true);
    }, []);

    const value = {
        user,
        isLoggedIn: !!user,
        isLoading,
        login,
        loginWithGoogle,
        register,
        logout,
        updateUser,
        authFlowVisible,
        requestAuthFlow,
        hideAuthFlow,
        driveAccessToken,
        authorizeDrive,
        setPin,
        verifyPin,
        requestPinReset,
        resetPin,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};