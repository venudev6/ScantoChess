/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { CloseIcon } from '../ui/Icons';
import './LoginView.css';

// Simple SVG Google Icon
const GoogleIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 48 48" width="20px" height="20px" {...props}>
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
        <path fill="none" d="M0 0h48v48H0z"></path>
    </svg>
);


interface LoginViewProps {
    onRegisterClick: () => void;
    onCancel: () => void;
}

const LoginView = ({ onRegisterClick, onCancel }: LoginViewProps) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isFormLoading, setIsFormLoading] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const { login, loginWithGoogle } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsFormLoading(true);
        try {
            await login(email, password);
            // On successful login, the onAuthStateChanged listener in AuthContext
            // will now handle hiding the auth flow.
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An unknown error occurred.');
        } finally {
            setIsFormLoading(false);
        }
    };
    
    const handleGoogleLogin = async () => {
        setError('');
        setIsGoogleLoading(true);
        try {
            await loginWithGoogle();
            // Success is handled by the global listener.
        } catch (err) {
             if (err instanceof Error && err.message.includes('auth/unauthorized-domain')) {
                const domain = window.location.origin;
                setError(`This domain (${domain}) is not authorized for sign-in.`);
            } else {
                setError(err instanceof Error ? err.message : 'Failed to sign in with Google.');
            }
        } finally {
            setIsGoogleLoading(false);
        }
    }

    const anyLoading = isFormLoading || isGoogleLoading;

    return (
        <div className="card auth-card">
            <button className="modal-close-btn" onClick={onCancel} aria-label="Close">
                <CloseIcon />
            </button>
            <h1 className="auth-title">Welcome Back</h1>
            <p className="auth-subtitle">Sign in to continue to Scan to Chess.</p>
            
            <form onSubmit={handleSubmit} className="auth-form">
                {error && <div className="auth-error-banner">{error}</div>}
                <div className="form-group">
                    <label htmlFor="email">Email Address</label>
                    <input
                        type="email"
                        id="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        disabled={anyLoading}
                    />
                </div>
                <div className="form-group">
                    <label htmlFor="password">Password</label>
                    <input
                        type="password"
                        id="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        disabled={anyLoading}
                    />
                </div>
                <button type="submit" className="btn btn-primary auth-submit-btn" disabled={anyLoading}>
                    {isFormLoading ? <div className="spinner-small"></div> : 'Sign In'}
                </button>
            </form>

            <div className="auth-separator"><span>OR</span></div>
            
             <button type="button" className="btn btn-secondary auth-submit-btn" onClick={handleGoogleLogin} disabled={anyLoading}>
                {isGoogleLoading ? <div className="spinner-small"></div> : <GoogleIcon />}
                {isGoogleLoading ? 'Signing In...' : 'Sign in with Google'}
            </button>
            
            <p className="auth-footer-text">
                Don't have an account?{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); onRegisterClick(); }}>
                    Sign Up
                </a>
                <span className="footer-link-separator">·</span>
                <a href="#" onClick={(e) => { e.preventDefault(); onCancel(); }}>Cancel</a>
            </p>
        </div>
    );
};

export default LoginView;