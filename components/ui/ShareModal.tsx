/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon, DownloadIcon, CopyIcon, CheckIcon } from './Icons';
import { Chess } from 'chess.js';
import type { HistoryEntry } from '../../lib/types';
import { generateBoardImageForSharing } from '../../lib/utils';
import './UserMenu.css'; // Reusing styles from UserMenu/BookmarkModal
import '../ui/components.css'; // For .fen-input-wrapper

interface ShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    chessInstance: Chess;
    history: HistoryEntry[];
    initialFen: string;
}

const convertSvgToPngDataURL = (svgUrl: string, width: number, height: number): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/png'));
            } else {
                reject(new Error("Could not get canvas context."));
            }
        };
        img.onerror = () => reject(new Error("Failed to load SVG image for conversion."));
        img.src = svgUrl;
    });
};


export const ShareModal = ({ isOpen, onClose, chessInstance, history, initialFen }: ShareModalProps) => {
    const [pngDataUrl, setPngDataUrl] = useState('');
    const [copyState, setCopyState] = useState<{ fen: 'idle' | 'copied'; pgn: 'idle' | 'copied'; image: 'idle' | 'copied'; }>({ fen: 'idle', pgn: 'idle', image: 'idle' });
    
    const pgn = useMemo(() => {
        if (!isOpen) return '';
        const tempGame = new Chess(initialFen);
        history.forEach(move => {
            try {
                tempGame.move({ from: move.from, to: move.to, promotion: move.promotion });
            } catch(e) { /* ignore invalid moves */ }
        });
        return tempGame.pgn();
    }, [isOpen, history, initialFen]);

    useEffect(() => {
        if (isOpen) {
            const fen = chessInstance.fen();
            const svgUrl = generateBoardImageForSharing(fen);
            convertSvgToPngDataURL(svgUrl, 400, 400).then(setPngDataUrl).catch(console.error);
        } else {
            setPngDataUrl('');
        }
    }, [isOpen, chessInstance]);
    
    const handleCopy = (text: string, type: 'fen' | 'pgn') => {
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            setCopyState(prev => ({ ...prev, [type]: 'copied' }));
            setTimeout(() => setCopyState(prev => ({...prev, [type]: 'idle'})), 2000);
        });
    };
    
    const handleCopyImage = async () => {
        if (!pngDataUrl) return;
        try {
            const response = await fetch(pngDataUrl);
            const blob = await response.blob();
            // @ts-ignore
            await navigator.clipboard.write([ new ClipboardItem({ 'image/png': blob }) ]);
            setCopyState(prev => ({ ...prev, image: 'copied' }));
            setTimeout(() => setCopyState(prev => ({...prev, image: 'idle'})), 2000);
        } catch (err) {
            console.error('Failed to copy image: ', err);
            alert('Failed to copy image to clipboard. Your browser might not support this feature or require a secure context (HTTPS).');
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="bookmark-modal-overlay" onClick={onClose}>
            <div className="bookmark-modal share-modal" onClick={(e) => e.stopPropagation()}>
                <div className="bookmark-modal-header">
                    <h3>Share Position</h3>
                    <button onClick={onClose} className="close-btn"><CloseIcon /></button>
                </div>
                <div className="share-image-preview">
                    {pngDataUrl ? <img src={pngDataUrl} alt="Chess position preview" /> : <div className="share-image-placeholder"><div className="spinner"></div></div>}
                </div>
                <div className="bookmark-form-group">
                    <label>Export Image</label>
                    <div className="share-button-group">
                         <a href={pngDataUrl} download={`chess-position.png`} className="btn btn-secondary"><DownloadIcon /> Download PNG</a>
                        <button className="btn btn-secondary" onClick={handleCopyImage}>{copyState.image === 'copied' ? <CheckIcon/> : <CopyIcon />} Copy Image</button>
                    </div>
                </div>
                <div className="bookmark-form-group">
                    <label htmlFor="fen-share">FEN</label>
                    <div className="fen-input-wrapper">
                        <input id="fen-share" type="text" value={chessInstance.fen()} readOnly className="fen-input" />
                        <button className="btn-icon copy-fen-btn" onClick={() => handleCopy(chessInstance.fen(), 'fen')} title="Copy FEN">{copyState.fen === 'copied' ? <CheckIcon /> : <CopyIcon />}</button>
                    </div>
                </div>
                <div className="bookmark-form-group">
                    <label htmlFor="pgn-share">PGN (Main Line)</label>
                    <div className="fen-input-wrapper">
                        <textarea id="pgn-share" value={pgn} readOnly className="fen-input" rows={2}></textarea>
                        <button className="btn-icon copy-fen-btn" onClick={() => handleCopy(pgn, 'pgn')} title="Copy PGN">{copyState.pgn === 'copied' ? <CheckIcon /> : <CopyIcon />}</button>
                    </div>
                </div>
                 <div className="bookmark-modal-actions">
                    <button className="btn btn-primary" onClick={onClose}>Done</button>
                </div>
            </div>
        </div>,
        document.body
    );
};
