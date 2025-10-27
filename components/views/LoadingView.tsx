

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect } from 'react';
import { UploadIcon, CheckIcon } from '../ui/Icons';
import './LoadingView.css';

interface LoadingViewProps {
    onCancel: () => void;
    scanFailed: boolean;
    onRetry: () => void;
    imageFile: File | null;
    errorMessage?: string | null;
    onContinueManually: () => void;
}

const loadingSteps = [
    "Compressing and uploading image",
    "Server is detecting the board",
    "Server is identifying piece positions",
    "Finalizing analysis...",
];


/**
 * A view displayed while the AI is analyzing the image.
 * It shows a spinner and a dynamic status message.
 * It can also display a "scan failed" message with tips and retry options.
 */
const LoadingView = ({ onCancel, scanFailed, onRetry, imageFile, errorMessage, onContinueManually }: LoadingViewProps) => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [currentStepIndex, setCurrentStepIndex] = useState(0);

    useEffect(() => {
        if (!scanFailed) {
            setCurrentStepIndex(0); // Reset on view load
            const interval = setInterval(() => {
                setCurrentStepIndex(prev => {
                    // Stop advancing once we reach the last step
                    if (prev < loadingSteps.length - 1) {
                        return prev + 1;
                    }
                    return prev;
                });
            }, 3500); // This duration feels more realistic for a multi-second process

            return () => clearInterval(interval);
        }
    }, [scanFailed]);


    const handleUploadFailureSample = () => {
        if (!imageFile) return;
        setIsSubmitting(true);
        // MOCK: In a real app, this would upload the `imageFile` to a backend service.
        setTimeout(() => {
            alert("Thank you for your feedback! The sample image has been submitted for analysis.");
            setIsSubmitting(false);
        }, 1000);
    };

    return (
        <div className="card loading-container">
            {!scanFailed && <div className="spinner"></div>}

            <h3>{scanFailed ? "Scan Failed" : "Scanning Position"}</h3>
            
            {scanFailed ? (
                 <>
                    <p>We couldn't recognize the board from the image.</p>
                    
                    {errorMessage && (
                        <div className="scan-failed-log">
                            <h4>Detailed Log</h4>
                            <pre>{errorMessage}</pre>
                        </div>
                    )}

                    <div className="scan-failed-tips">
                        <h3>Tips for a Better Scan:</h3>
                        <ul>
                           <li><strong>Clear View:</strong> Ensure the board is not obstructed.</li>
                           <li><strong>Good Lighting:</strong> Avoid glare and shadows.</li>
                           <li><strong>Flat Angle:</strong> A top-down view works best.</li>
                           <li><strong>High Contrast:</strong> Clear distinction between pieces and squares.</li>
                        </ul>
                    </div>
                     <div className="failure-actions-container">
                        <div className="button-group">
                            <button className="btn btn-secondary" onClick={onCancel}>Start Over</button>
                            <button className="btn btn-secondary" onClick={onContinueManually}>Edit Manually</button>
                            <button className="btn btn-primary" onClick={onRetry}>Try Again</button>
                        </div>
                        <div className="feedback-section">
                            <p>Help improve our scans!</p>
                            <button className="btn btn-secondary" onClick={handleUploadFailureSample} disabled={isSubmitting || !imageFile}>
                                {isSubmitting ? <div className="spinner-small"></div> : <UploadIcon />}
                                {isSubmitting ? 'Submitting...' : 'Upload Failed Image'}
                            </button>
                        </div>
                    </div>
                </>
            ) : (
                <>
                    <ul className="loading-steps-list">
                        {loadingSteps.map((step, index) => (
                            <li key={index} className={`loading-step ${index < currentStepIndex ? 'completed' : ''} ${index === currentStepIndex ? 'active' : ''}`}>
                                 <div className="step-status-icon">
                                     <CheckIcon/>
                                     <div className="step-spinner"></div>
                                 </div>
                                 <span>{step}</span>
                            </li>
                        ))}
                    </ul>
                    <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
                </>
            )}
        </div>
    );
};

export default LoadingView;
