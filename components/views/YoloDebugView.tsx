/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect } from 'react';
import { BackIcon, CopyIcon, CheckIcon } from '../ui/Icons';
import './YoloDebugView.css';
import './AdminView.css'; // for .admin-header

interface YoloDebugViewProps {
    onBack: () => void;
}

interface DebugData {
    payload: { image: string };
    response: any;
    endpoint: string;
}

const YoloDebugView = ({ onBack }: YoloDebugViewProps) => {
    const [data, setData] = useState<DebugData | null>(null);
    const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copyStatus, setCopyStatus] = useState<'command' | 'response' | null>(null);

    useEffect(() => {
        try {
            const storedData = sessionStorage.getItem('yoloDebugData');
            if (storedData) {
                const parsedData = JSON.parse(storedData) as DebugData;
                setData(parsedData);
                if (parsedData.payload && parsedData.payload.image) {
                    // The image sent to the YOLO server is a PNG generated from a canvas blob.
                    setImageDataUrl(`data:image/png;base64,${parsedData.payload.image}`);
                }
            } else {
                setError("No debug data found in session. This page may have been opened directly. Please go back and generate a log first.");
            }
        } catch (e) {
            setError("Failed to parse debug data from session storage.");
        }
    }, []);
    
    const handleCopy = (text: string, type: 'command' | 'response') => {
        navigator.clipboard.writeText(text).then(() => {
            setCopyStatus(type);
            setTimeout(() => setCopyStatus(null), 2000);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            alert('Failed to copy to clipboard.');
        });
    };

    const fullCurlCommand = data ? `curl -X POST -H "Content-Type: application/json" -d '${JSON.stringify(data.payload)}' ${data.endpoint}` : '';
    
    const truncatedCurlCommand = data 
        ? `curl -X POST -H "Content-Type: application/json" -d '{"image":"${data.payload.image.substring(0, 80)}..."}' ${data.endpoint}` 
        : '';


    return (
        <div className="card yolo-debug-view">
            <div className="admin-header">
                <button className="btn-icon" onClick={onBack} title="Back to Home" aria-label="Back to Home">
                    <BackIcon />
                </button>
                <h1>YOLOv8 Server Log</h1>
            </div>

            {error ? (
                <div className="auth-error-banner">{error}</div>
            ) : !data ? (
                <div className="loading-container"><div className="spinner"></div></div>
            ) : (
                <>
                    {imageDataUrl && (
                        <div className="yolo-debug-section">
                            <h2>Input Image</h2>
                            <div className="yolo-image-preview">
                                <img src={imageDataUrl} alt="Image sent to YOLOv8 server for turn detection" />
                            </div>
                        </div>
                    )}
                    <div className="yolo-debug-section">
                        <h2>Request Command (cURL)</h2>
                        <pre>
                            <div className="copy-btn-wrapper">
                                <button className="btn-icon copy-btn" onClick={() => handleCopy(fullCurlCommand, 'command')} title="Copy Full Command">
                                    {copyStatus === 'command' ? <CheckIcon /> : <CopyIcon />}
                                </button>
                            </div>
                            <code>{truncatedCurlCommand}</code>
                        </pre>
                    </div>
                    <div className="yolo-debug-section">
                        <h2>Server Response (JSON)</h2>
                        <pre>
                             <div className="copy-btn-wrapper">
                                <button className="btn-icon copy-btn" onClick={() => handleCopy(JSON.stringify(data.response, null, 2), 'response')} title="Copy JSON">
                                     {copyStatus === 'response' ? <CheckIcon /> : <CopyIcon />}
                                </button>
                            </div>
                            <code>{JSON.stringify(data.response, null, 2)}</code>
                        </pre>
                    </div>
                </>
            )}
        </div>
    );
};

export default YoloDebugView;