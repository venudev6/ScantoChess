/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { UserCircleIcon, LogoutIcon, AccountIcon, BookmarkIcon, HistoryIcon, SettingsIcon, ChevronRightIcon, BoardIcon, GameplayIcon, ExternalLinkIcon, LockIcon, CheckIcon, WarningIcon, RobotIcon, HumanIcon, AdviceIcon } from '../ui/Icons';
import type { User, AnalysisDetails } from '../../lib/types';
import { useAppSettings } from '../../hooks/useAppSettings';
import { PieceSetSelectorModal } from '../ui/PieceSetSelectorModal';
import { Logo } from '../ui/Logo';
import './UserPanel.css';

type AppSettings = ReturnType<typeof useAppSettings>;
type OpenSection = 'scanDetails' | 'boardSettings' | 'engineSettings' | 'devLogs' | null;


interface UserPanelProps {
    user: User | null;
    isLoggedIn: boolean;
    onLogout: () => void;
    onAdminPanelClick: () => void;
    onSavedGamesClick: () => void;
    onHistoryClick: () => void;
    onProfileClick: () => void;
    onLoginClick: () => void;
    appSettings: AppSettings;
    scanDuration: number | null;
    clientProcessingTime: number | null;
    serverProcessingTime: number | null;
    analysisDetails: AnalysisDetails | null;
    debugLog?: string[];
    bestMove?: string | null;
    displayMode: 'full' | 'compact';
    isEngineReady?: boolean;
    isThinking?: boolean;
    playerSide?: 'w' | 'b' | null;
    turn?: 'w' | 'b';
    onSettingsClick?: () => void;
    onHome?: () => void;
}

const UserPanel = ({ user, isLoggedIn, onLogout, onAdminPanelClick, onSavedGamesClick, onHistoryClick, onProfileClick, onLoginClick, appSettings, scanDuration, clientProcessingTime, serverProcessingTime, analysisDetails, debugLog, bestMove, displayMode, isEngineReady, isThinking, playerSide, turn, onSettingsClick, onHome }: UserPanelProps) => {
    const [openSection, setOpenSection] = useState<OpenSection>(null);
    const [isPieceSetModalOpen, setIsPieceSetModalOpen] = useState(false);
    const debugLogRef = useRef<HTMLDivElement>(null);

    const toggleSection = (section: NonNullable<OpenSection>) => {
        setOpenSection(prev => (prev === section ? null : section));
    };

    const handleViewYoloLog = () => {
        if (analysisDetails?.yoloRequestPayload && analysisDetails?.yoloResponse) {
            const debugData = {
                payload: analysisDetails.yoloRequestPayload,
                response: analysisDetails.yoloResponse,
                endpoint: 'https://server-nandan-yolov8-466929233043.asia-south1.run.app/predict'
            };
            sessionStorage.setItem('yoloDebugData', JSON.stringify(debugData));
            window.open('/?view=yolo-debug', '_blank');
        }
    };

    // The calculation logic
    const networkTime = useMemo(() => {
        if (scanDuration === null || clientProcessingTime === null || serverProcessingTime === null) return null;
        // scanDuration is in seconds, clientProcessingTime and serverProcessingTime are in ms
        const totalMs = scanDuration * 1000;
        const result = totalMs - clientProcessingTime - serverProcessingTime;
        return result > 0 ? result / 1000 : 0;
    }, [scanDuration, clientProcessingTime, serverProcessingTime]);


    // Effect to auto-scroll the debug log
    useEffect(() => {
        if (debugLogRef.current) {
            debugLogRef.current.scrollTop = debugLogRef.current.scrollHeight;
        }
    }, [debugLog, openSection]);

    const getConfidenceClass = (confidence: number | null) => {
        if (confidence === null || confidence === undefined) return '';
        if (confidence >= 0.95) return 'accuracy-high';
        if (confidence >= 0.85) return 'accuracy-medium';
        return 'accuracy-low';
    };
    
    const timingStages: { key: keyof NonNullable<AnalysisDetails['timingSummary']>, name: string }[] = [
        { key: 'board_detection_ms', name: 'Board Detection (OpenCV)' },
        { key: 'perspective_warp_ms', name: 'Perspective Warp (OpenCV)' },
        { key: 'tile_slicing_ms', name: 'Tile Slicing (OpenCV)' },
        { key: 'ocr_turn_detection_ms', name: 'Client Turn OCR (Tesseract)' },
        { key: 'shape_turn_detection_ms', name: 'Client Turn Shape Detection' },
        { key: 'tile_classification_ms', name: 'Piece Classification' },
        { key: 'post_processing_ms', name: 'Post-Processing' },
    ];


    if (!isLoggedIn || !user) {
        return (
            <aside className="user-panel guest-panel">
                <div className="user-panel-header" onClick={onLoginClick}>
                    <div className="user-avatar"><UserCircleIcon /></div>
                    <div className="user-info">
                        <span className="user-email">Guest User</span>
                        <span className={`role-badge role-guest`}>Trial</span>
                    </div>
                </div>
                <div className="guest-panel-content">
                    <p>Log in or sign up to save games and access your full history.</p>
                    <button className="btn btn-primary" onClick={onLoginClick}>
                        Login / Sign Up
                    </button>
                </div>
            </aside>
        );
    }

    return (
        <aside className={`user-panel ${displayMode}-panel`}>
            {displayMode === 'compact' && onHome && (
                <button className="btn-icon-bare home-logo-btn" onClick={onHome} title="Go to Home Screen" aria-label="Go to Home Screen">
                    <Logo />
                </button>
            )}
            <PieceSetSelectorModal isOpen={isPieceSetModalOpen} onClose={() => setIsPieceSetModalOpen(false)} appSettings={appSettings} />
            <button className="user-panel-header" onClick={onProfileClick} title="View your profile">
                <div className="user-avatar">
                    {user.photoUrl ? <img src={user.photoUrl} alt="User avatar" /> : <UserCircleIcon />}
                </div>
                <div className="user-info">
                    <span className="user-email" title={user.name || user.email}>{user.name || user.email}</span>
                    <span className={`role-badge role-${user.role}`}>{user.role}</span>
                </div>
            </button>

            {displayMode === 'compact' && onSettingsClick && (
                <button className="btn-icon-bare settings-toggle-btn" onClick={onSettingsClick} title="Open Settings">
                    <SettingsIcon />
                </button>
            )}
            
            <div className="user-panel-scroll-container">
                {displayMode === 'full' && (
                    <div className="user-panel-details-section">
                        {(scanDuration !== null || (analysisDetails && analysisDetails.confidence !== null)) && (
                            <div className="scan-stats-container">
                                {scanDuration !== null && scanDuration > 0 && (
                                    <div className="scan-stat">
                                        <span>Total Scan Time</span>
                                        <strong>{scanDuration.toFixed(1)}s</strong>
                                    </div>
                                )}
                                {clientProcessingTime !== null && clientProcessingTime > 0 && (
                                    <div className="scan-stat">
                                        <span>Client Processing</span>
                                        <strong>{(clientProcessingTime / 1000).toFixed(2)}s</strong>
                                    </div>
                                )}
                                {serverProcessingTime !== null && serverProcessingTime > 0 && (
                                    <div className="scan-stat">
                                        <span>Server Processing</span>
                                        <strong>{(serverProcessingTime / 1000).toFixed(2)}s</strong>
                                    </div>
                                )}
                                {networkTime !== null && networkTime > 0 && (
                                    <div className="scan-stat">
                                        <span>Network Latency</span>
                                        <strong>{networkTime.toFixed(2)}s</strong>
                                    </div>
                                )}
                                {analysisDetails && analysisDetails.confidence !== null && (
                                    <div className="scan-stat">
                                        <span>Avg. Accuracy</span>
                                        <strong className={getConfidenceClass(analysisDetails.confidence)}>
                                            {(analysisDetails.confidence * 100).toFixed(1)}%
                                        </strong>
                                    </div>
                                )}
                                {analysisDetails?.postProcess?.minimumConfidence !== null && analysisDetails?.postProcess?.minimumConfidence !== undefined && (
                                    <div className="scan-stat">
                                        <span>Min. Accuracy</span>
                                        <strong className={getConfidenceClass(analysisDetails.postProcess.minimumConfidence)}>
                                            {(analysisDetails.postProcess.minimumConfidence * 100).toFixed(1)}%
                                        </strong>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <nav className="user-panel-nav">
                    {displayMode === 'full' && (analysisDetails?.timingSummary || (analysisDetails?.individualScans && analysisDetails.individualScans.length > 0) || (analysisDetails?.postProcess?.autoFixes && analysisDetails.postProcess.autoFixes.length > 0)) && (
                        <div className="collapsible-section">
                             <button className={`user-menu-item ${openSection === 'scanDetails' ? 'active-section' : ''}`} onClick={() => toggleSection('scanDetails')}>
                                <AdviceIcon />
                                <span>Scan Details</span>
                                <ChevronRightIcon style={{ transform: openSection === 'scanDetails' ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }} />
                            </button>
                            {openSection === 'scanDetails' && (
                                <div className="collapsible-content">
                                    {analysisDetails?.timingSummary && (
                                        <div className="scan-timing-details">
                                            <h4>Scan Breakdown</h4>
                                            <ul>
                                                {timingStages.map(stage => {
                                                    const duration = analysisDetails.timingSummary![stage.key as keyof typeof analysisDetails.timingSummary];
                                                    return duration !== undefined && duration !== null && duration > 0 && (
                                                        <li key={stage.key}>
                                                            <span>{stage.name}</span>
                                                            <strong>{(duration / 1000).toFixed(2)}s</strong>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        </div>
                                    )}

                                    {analysisDetails?.warpedImageDataUrl && (
                                        <div className="scan-timing-details">
                                            <h4>OpenCV Response (Warped Image)</h4>
                                            <img src={analysisDetails.warpedImageDataUrl} alt="Warped image used for analysis" style={{width: '100%', borderRadius: '4px', border: '1px solid var(--border-color)', marginTop: '0.5rem'}}/>
                                        </div>
                                    )}

                                    {analysisDetails?.postProcess?.autoFixes && analysisDetails.postProcess.autoFixes.length > 0 && (
                                        <div className="post-scan-validations">
                                            <h4>Post-Scan Validations ({analysisDetails.postProcess.autoFixes.length})</h4>
                                            <ul>
                                                {analysisDetails.postProcess.autoFixes.map((fix, index) => (
                                                    <li key={index} className={fix.type}>
                                                        {fix.type === 'fix' ? <CheckIcon /> : <WarningIcon />}
                                                        {fix.message}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    {user.role === 'admin' && (
                        <button className="user-menu-item" onClick={onAdminPanelClick} title="Go to the Admin Panel">
                            <AccountIcon /><span>Admin Panel</span>
                        </button>
                    )}
                    <button className="user-menu-item" onClick={onSavedGamesClick} title="View your saved games">
                        <BookmarkIcon /><span>Saved Games</span>
                    </button>
                    <button className="user-menu-item" onClick={onHistoryClick} title="View your game history">
                        <HistoryIcon /><span>Game History</span>
                    </button>
                    
                    {analysisDetails?.yoloResponse && displayMode === 'full' && (
                        <button className="user-menu-item" onClick={handleViewYoloLog} title="View the full YOLOv8 server log for turn detection">
                            <ExternalLinkIcon /><span>Turn Detection Log</span>
                        </button>
                    )}
                    
                    <button className={`user-menu-item ${openSection === 'boardSettings' ? 'active-section' : ''}`} onClick={() => toggleSection('boardSettings')}>
                        <SettingsIcon />
                        <span>Board Settings</span>
                        <ChevronRightIcon style={{ transform: openSection === 'boardSettings' ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }} />
                    </button>
                    
                    {openSection === 'boardSettings' && (
                        <div className="user-panel-settings">
                            <div className="setting-item">
                                <div className="setting-label">
                                    <BoardIcon />
                                    <span>Board Theme</span>
                                </div>
                                <div className="theme-selector-group">
                                    {(['default', 'green', 'blue', 'wood'] as const).map(theme => (
                                        <div className="theme-option" key={theme}>
                                            <input
                                                type="radio"
                                                id={`theme-panel-${theme}`}
                                                name="board-theme-panel"
                                                value={theme}
                                                checked={appSettings.boardTheme === theme}
                                                onChange={() => appSettings.handleBoardThemeChange(theme)}
                                            />
                                            <label htmlFor={`theme-panel-${theme}`} title={`Set board theme to ${theme.charAt(0).toUpperCase() + theme.slice(1)}`}>
                                                <div className={`theme-preview theme-preview-${theme}`}></div>
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="setting-item">
                               <button className="setting-item-button" onClick={() => setIsPieceSetModalOpen(true)}>
                                    <div className="setting-label">
                                        <GameplayIcon />
                                        <span>Piece Set</span>
                                    </div>
                                    <div className="setting-value">
                                        <span>{appSettings.pieceTheme.charAt(0).toUpperCase() + appSettings.pieceTheme.slice(1)}</span>
                                        <ChevronRightIcon />
                                    </div>
                               </button>
                            </div>
                            <div className="setting-item">
                                <div className="tooltip-container setting-label" title="Set the speed of the computer's piece animations">
                                    <BoardIcon />
                                    <span>Animation Speed</span>
                                    <span className="tooltip-text">None: Instant, Slow: 0.8s, Medium: 0.4s, Fast: 0.2s</span>
                                </div>
                                <div className="segmented-control">
                                    {(['none', 'slow', 'medium', 'fast'] as const).map(speed => (
                                        <div className="segmented-option" key={speed}>
                                            <input
                                                type="radio"
                                                id={`speed-panel-${speed}`}
                                                name="animation-speed-panel"
                                                value={speed}
                                                checked={appSettings.pieceAnimationSpeed === speed}
                                                onChange={() => appSettings.handlePieceAnimationSpeedChange(speed)}
                                            />
                                            <label htmlFor={`speed-panel-${speed}`} title={`Set animation speed to ${speed}`}>
                                                {speed.charAt(0).toUpperCase() + speed.slice(1)}
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="setting-item">
                                 <div className="setting-label">
                                    <ExternalLinkIcon />
                                    <span>External Analysis</span>
                                </div>
                                <div className="setting-sub-item">
                                    <label htmlFor="cooldown-slider-panel">
                                       Cooldown: <strong>{Math.floor(appSettings.analysisCooldown / 60)} min</strong>
                                       {appSettings.cooldownLocked && <LockIcon />}
                                    </label>
                                     <input
                                        type="range"
                                        id="cooldown-slider-panel"
                                        min="0"
                                        max="1800"
                                        step="60"
                                        value={appSettings.analysisCooldown}
                                        onChange={(e) => appSettings.handleCooldownChange(parseInt(e.target.value, 10))}
                                        aria-label="Analysis button cooldown time"
                                        title={appSettings.cooldownLocked ? "Unlock in Profile settings to change" : "Set the cooldown time for external analysis links"}
                                        disabled={appSettings.cooldownLocked}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                     {debugLog && (
                        <>
                            <button className={`user-menu-item ${openSection === 'engineSettings' ? 'active-section' : ''}`} onClick={() => toggleSection('engineSettings')}>
                                <RobotIcon/>
                                <span>Engine Settings</span>
                                <ChevronRightIcon style={{ transform: openSection === 'engineSettings' ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }} />
                            </button>
                            {openSection === 'engineSettings' && (
                                 <div className="user-panel-settings">
                                    <div className="engine-setting-item">
                                        <label htmlFor="engine-enabled-toggle">Play vs. Engine</label>
                                        <div className="toggle-switch" title={appSettings.engineEnabled ? 'Disable Engine' : 'Enable Engine'}>
                                            <label className="switch">
                                                <input 
                                                    type="checkbox" 
                                                    id="engine-enabled-toggle"
                                                    checked={appSettings.engineEnabled} 
                                                    onChange={(e) => appSettings.handleEngineEnabledChange(e.target.checked)} 
                                                />
                                                <span className="slider round"></span>
                                            </label>
                                        </div>
                                    </div>

                                    <div className={`engine-setting-item ${!appSettings.engineEnabled ? 'disabled' : ''}`}>
                                        <label htmlFor="engine-difficulty-select">Difficulty</label>
                                        <select 
                                            id="engine-difficulty-select" 
                                            value={appSettings.engineDifficulty} 
                                            onChange={(e) => appSettings.handleEngineDifficultyChange(e.target.value as 'standard' | 'hard' | 'extra-hard')}
                                            disabled={!appSettings.engineEnabled}
                                        >
                                            <option value="standard">Standard</option>
                                            <option value="hard">Hard</option>
                                            <option value="extra-hard">Extra Hard</option>
                                        </select>
                                    </div>

                                    <div className="engine-status-line">
                                        <span>Status:</span>
                                        <span className={`engine-status ${!appSettings.engineEnabled ? 'disabled' : isEngineReady ? 'ready' : 'loading'}`}>
                                            {appSettings.engineEnabled ? (isEngineReady ? 'Ready' : 'Initializing...') : 'Disabled'}
                                        </span>
                                    </div>
                                    
                                    {playerSide && appSettings.engineEnabled && (
                                        <div className={`play-vs-computer-status ${isThinking && turn !== playerSide ? 'thinking' : ''}`}>
                                            {turn === playerSide ? <HumanIcon/> : <RobotIcon />}
                                            <span>
                                                {isThinking && turn !== playerSide ? "Computer is thinking..." :
                                                turn === playerSide ? `Your turn (as ${playerSide === 'w' ? 'White' : 'Black'})` : "Computer's turn..."}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                     )}
                     {(bestMove || (debugLog && debugLog.length > 0)) && (
                        <>
                            <button className={`user-menu-item ${openSection === 'devLogs' ? 'active-section' : ''}`} onClick={() => toggleSection('devLogs')}>
                                <AdviceIcon />
                                <span>Dev logs</span>
                                <ChevronRightIcon style={{ transform: openSection === 'devLogs' ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }} />
                            </button>
                            {openSection === 'devLogs' && (
                                <div className="user-panel-settings">
                                    {bestMove && (
                                        <div className="engine-analysis-section">
                                            <div className="best-move-line">
                                                <strong>Best Move:</strong>
                                                <span>{bestMove}</span>
                                            </div>
                                        </div>
                                    )}
                                    {debugLog && debugLog.length > 0 && (
                                        <div className="engine-debug-log-section">
                                            <h4>Dev logs</h4>
                                            <div className="engine-debug-log" ref={debugLogRef}>
                                                {debugLog.map((line, index) => <div key={index}>{line}</div>)}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </nav>
            </div>
            
            <div className="logout-wrapper">
                <button className="user-menu-item" onClick={onLogout} title="Log out">
                    <LogoutIcon /> <span>Logout</span>
                </button>
            </div>
        </aside>
    );
};

export default UserPanel;