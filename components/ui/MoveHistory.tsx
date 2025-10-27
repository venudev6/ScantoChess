/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useEffect, useRef, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Chess } from 'chess.js';
import type { HistoryEntry } from '../../lib/types';
import { CommentIcon, TrashIcon } from './Icons';
import { sanToSymbolic } from '../../lib/utils';
import { ConfirmationDialog } from './ConfirmationDialog';
import './MoveHistory.css';

/**
 * Renders a single move (e.g., "♘f3") as a clickable span.
 */
const MoveNode = ({ move, currentNodeId, onNavigate }: {
    move: HistoryEntry,
    currentNodeId: string,
    onNavigate: (nodeId: string) => void,
}) => {
    const isActive = currentNodeId === move.id;
    return (
        <span
            className={`move-notation move-color-${move.color} ${isActive ? 'active' : ''}`}
            onClick={() => onNavigate(move.id)}
            role="button"
            tabIndex={0}
        >
            {sanToSymbolic(move.san, move.color)}
            {move.comment && <CommentIcon className="comment-indicator-icon" />}
        </span>
    );
};


const alphabet = 'abcdefghijklmnopqrstuvwxyz';

// FIX: Define props interface and use React.FC to correctly type the component for JSX, resolving the 'key' prop error.
interface RenderVariationTreeProps {
    node: HistoryEntry;
    depth: number;
    parentFen: string;
    onNavigate: (nodeId: string) => void;
    currentNodeId: string;
    siblingIndex: number;
    collapsedState: Record<string, boolean>;
    onToggleCollapse: (nodeId: string) => void;
    onArchiveRequest: (node: HistoryEntry) => void;
    onRestoreBranch: (nodeId: string) => void;
}

const RenderVariationTree: React.FC<RenderVariationTreeProps> = ({ node, depth, parentFen, onNavigate, currentNodeId, siblingIndex, collapsedState, onToggleCollapse, onArchiveRequest, onRestoreBranch }) => {
    // If the branch is archived, render the archived view.
    if (node.archived) {
        return (
            <div className="variation-line archived">
                [Archived]
                <button onClick={() => onRestoreBranch(node.id)} className="restore-btn">Restore</button>
            </div>
        );
    }

    // This function renders a single continuous line of a variation.
    const primaryLine: HistoryEntry[] = [];
    let current: HistoryEntry | undefined = node;
    while (current) {
        primaryLine.push(current);
        current = current.children.length > 0 ? current.children[0] : undefined;
    }

    const game = new Chess(parentFen);

    return (
        <div className="variation-line-wrapper">
            <TrashIcon className="delete-branch-icon" onClick={() => onArchiveRequest(node)} title="Archive this branch" />
            <span className="variation-line">
                {primaryLine.map((move, i) => {
                    const moveNum = game.moveNumber();
                    const isWhiteToMove = game.turn() === 'w';
                    const showMoveNumber = isWhiteToMove || (i === 0 && !isWhiteToMove);

                    try {
                        const moveResult = game.move({ from: move.from, to: move.to, promotion: move.promotion });
                        if (!moveResult) {
                             console.error('Invalid move in variation tree', move.san);
                        }
                    } catch (e) {}

                    const subVariations = move.children.slice(1);
                    
                    return (
                        <React.Fragment key={move.id}>
                            {showMoveNumber && (
                                <span className="variation-move-number" title={`Variation move ${moveNum}`}>
                                    {`${moveNum}.`}
                                    {i === 0 && siblingIndex > -1 ? alphabet[siblingIndex] : ''}
                                    {isWhiteToMove ? ' ' : '.. '}
                                </span>
                            )}
                            <MoveNode 
                                move={move} 
                                onNavigate={onNavigate} 
                                currentNodeId={currentNodeId}
                            />
                            {subVariations.length > 0 && (
                                <VariationGroup
                                    nodes={subVariations}
                                    parentMoveId={move.id}
                                    depth={depth + 1}
                                    parentFen={move.fen}
                                    onNavigate={onNavigate}
                                    currentNodeId={currentNodeId}
                                    collapsedState={collapsedState}
                                    onToggleCollapse={onToggleCollapse}
                                    onArchiveRequest={onArchiveRequest}
                                    onRestoreBranch={onRestoreBranch}
                                />
                            )}
                        </React.Fragment>
                    );
                })}
            </span>
        </div>
    );
};

const VariationGroup = ({ nodes, parentMoveId, depth, parentFen, onNavigate, currentNodeId, collapsedState, onToggleCollapse, onArchiveRequest, onRestoreBranch }: {
    nodes: HistoryEntry[];
    parentMoveId: string;
    depth: number;
    parentFen: string;
    onNavigate: (nodeId: string) => void;
    currentNodeId: string;
    collapsedState: Record<string, boolean>;
    onToggleCollapse: (nodeId: string) => void;
    onArchiveRequest: (node: HistoryEntry) => void;
    onRestoreBranch: (nodeId: string) => void;
}) => {
    const isCollapsed = collapsedState[parentMoveId] ?? false;
    const isCompact = nodes.length > 1 && nodes.every(n => !n.children.some(c => c.children.length > 0));

    return (
        <div className={`variation-group ${isCompact ? 'compact' : ''}`} style={{ '--depth': depth } as React.CSSProperties}>
            <span className="variation-paren opening-paren">⦗</span>
            <button className="collapse-toggle" onClick={() => onToggleCollapse(parentMoveId)} title={isCollapsed ? "Expand variations" : "Collapse variations"}>
                {isCollapsed ? '▶' : '▼'}
            </button>
            {isCollapsed ? (
                <span className="collapsed-indicator" onClick={() => onToggleCollapse(parentMoveId)}>...</span>
            ) : (
                nodes.map((node, index) => (
                    <RenderVariationTree
                        key={node.id}
                        node={node}
                        depth={depth}
                        parentFen={parentFen}
                        onNavigate={onNavigate}
                        currentNodeId={currentNodeId}
                        siblingIndex={nodes.length > 1 ? index : -1}
                        collapsedState={collapsedState}
                        onToggleCollapse={onToggleCollapse}
                        onArchiveRequest={onArchiveRequest}
                        onRestoreBranch={onRestoreBranch}
                    />
                ))
            )}
            <span className="variation-paren closing-paren">⦘</span>
        </div>
    );
};

interface MoveHistoryProps {
    rootNode: HistoryEntry;
    currentNode: HistoryEntry;
    onNavigate: (nodeId: string) => void;
    onArchiveBranch: (nodeId: string) => void;
    onRestoreBranch: (nodeId: string) => void;
}

const MoveHistory = ({ rootNode, currentNode, onNavigate, onArchiveBranch, onRestoreBranch }: MoveHistoryProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [collapsedVariations, setCollapsedVariations] = useState<Record<string, boolean>>({});
    const [branchToArchive, setBranchToArchive] = useState<HistoryEntry | null>(null);

    const toggleCollapse = (nodeId: string) => {
        setCollapsedVariations(prev => ({...prev, [nodeId]: !prev[nodeId]}));
    };
    
    const handleArchiveRequest = (node: HistoryEntry) => {
        setBranchToArchive(node);
    };

    const handleConfirmArchive = () => {
        if (branchToArchive) {
            onArchiveBranch(branchToArchive.id);
        }
        setBranchToArchive(null);
    };
    
    const mainLine = useMemo(() => {
        const line: HistoryEntry[] = [];
        let current = rootNode.children.length > 0 ? rootNode.children[0] : undefined;
        while (current) {
            line.push(current);
            current = current.children.length > 0 ? current.children[0] : undefined;
        }
        return line;
    }, [rootNode]);

    const mainLinePairs = useMemo(() => {
        if (!mainLine || mainLine.length === 0) return [];
        const pairs: { moveNum: number; white: HistoryEntry; black?: HistoryEntry }[] = [];
        for (let i = 0; i < mainLine.length; i += 2) {
            pairs.push({ moveNum: Math.floor(i / 2) + 1, white: mainLine[i], black: mainLine[i + 1] });
        }
        return pairs;
    }, [mainLine]);

    useEffect(() => {
        const activeElement = containerRef.current?.querySelector('.move-notation.active');
        if (activeElement) {
            activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [currentNode.id]);

    return (
        <div className="move-history-panel">
            <div className="move-history-content" ref={containerRef}>
                {mainLinePairs.length > 0 ? (
                    <div className="move-list">
                       {mainLinePairs.map(({ moveNum, white, black }) => {
                            const whiteVariations = white?.children.filter(c => c.id !== black?.id) || [];
                            
                            const blackNodeIndex = black ? mainLine.findIndex(n => n.id === black.id) : -1;
                            const nextOnMainLine = blackNodeIndex > -1 && blackNodeIndex + 1 < mainLine.length ? mainLine[blackNodeIndex + 1] : undefined;
                            const blackVariations = black?.children.filter(c => c.id !== nextOnMainLine?.id) || [];

                            const fenForWhiteVariations = white.fen;
                            const fenForBlackVariations = black ? black.fen : '';

                            return (
                                <React.Fragment key={white.id}>
                                    <div className="move-line">
                                        <span className="move-number">{`${moveNum}.`}</span>
                                        <div className="move-container white-move">
                                            <MoveNode 
                                                move={white} 
                                                onNavigate={onNavigate} 
                                                currentNodeId={currentNode.id} 
                                            />
                                        </div>
                                        <div className="move-container black-move">
                                            {black && 
                                                <MoveNode 
                                                    move={black} 
                                                    onNavigate={onNavigate} 
                                                    currentNodeId={currentNode.id} 
                                                />}
                                        </div>
                                    </div>
                                    {whiteVariations.length > 0 && (
                                        <VariationGroup
                                            nodes={whiteVariations}
                                            parentMoveId={white.id}
                                            depth={0}
                                            parentFen={fenForWhiteVariations}
                                            onNavigate={onNavigate}
                                            currentNodeId={currentNode.id}
                                            collapsedState={collapsedVariations}
                                            onToggleCollapse={toggleCollapse}
                                            onArchiveRequest={handleArchiveRequest}
                                            onRestoreBranch={onRestoreBranch}
                                        />
                                    )}
                                    {black && blackVariations.length > 0 && (
                                        <VariationGroup
                                            nodes={blackVariations}
                                            parentMoveId={black.id}
                                            depth={0}
                                            parentFen={fenForBlackVariations}
                                            onNavigate={onNavigate}
                                            currentNodeId={currentNode.id}
                                            collapsedState={collapsedVariations}
                                            onToggleCollapse={toggleCollapse}
                                            onArchiveRequest={handleArchiveRequest}
                                            onRestoreBranch={onRestoreBranch}
                                        />
                                    )}
                                </React.Fragment>
                            );
                       })}
                    </div>
                ) : (
                    <div className="no-moves-placeholder">
                        <h4>Move History</h4>
                    </div>
                )}
            </div>
             <ConfirmationDialog
                isOpen={!!branchToArchive}
                title="Archive Branch"
                message={`Archive branch starting with "${branchToArchive?.san}"? This can be undone.`}
                onConfirm={handleConfirmArchive}
                onClose={() => setBranchToArchive(null)}
                confirmText="Archive Branch"
                cancelText="Cancel"
            />
        </div>
    );
};

export default React.memo(MoveHistory);