/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import type { Square as ChessJSSquare, PieceSymbol as ChessJSPieceSymbol, Move } from 'chess.js';
import { soundManager } from '../lib/SoundManager';
import { fenToBoardState } from '../lib/fenUtils';
import { FILES, RANKS, INITIAL_FEN } from '../lib/chessConstants';
import type { BoardState, HistoryEntry, PieceColor, PieceSymbol } from '../lib/types';
// FIX: Import findPathToNode from utils.
import { findPathToNode } from '../lib/utils';

type SoundType = 'MOVE' | 'CAPTURE' | 'CHECKMATE';

/**
 * Creates a unique identifier for a move.
 */
const createMoveId = () => `${Date.now()}-${Math.random()}`;

/**
 * A "dummy" root node representing the state *before* any moves are made.
 * Its children are the possible first moves.
 */
const createRootNode = (fen: string): HistoryEntry => ({
  id: 'root_' + Date.now(),
  fen,
  san: null,
  from: '' as ChessJSSquare,
  to: '' as ChessJSSquare,
  color: fen.split(' ')[1] === 'b' ? 'w' : 'b', // color of player *before* this position
  children: [],
});

/**
 * A comprehensive hook for managing the state of a chess game with a branching, tree-based history.
 * It uses the chess.js library for underlying game logic and a copy-on-write approach for immutable state updates.
 */
export const useChessGame = (initialFen: string, initialHistory?: HistoryEntry[]) => {
    
    // The root of the entire move tree. Changes to this trigger a re-render of the whole game state.
    const [rootNode, setRootNode] = useState<HistoryEntry>(() => createRootNode(initialFen));
    
    // The ID of the currently displayed move. Changing this triggers re-renders.
    const [currentNodeId, setCurrentNodeId] = useState<string>(rootNode.id);
    
    // State to queue up the next sound to play as a reactive side-effect.
    const [soundToPlay, setSoundToPlay] = useState<SoundType | null>(null);

    // This effect runs once to build the initial move tree if linear history is provided.
    useEffect(() => {
        const root = createRootNode(initialFen);
        let current = root;
        if (initialHistory && initialHistory.length > 0) {
            initialHistory.forEach(moveData => {
                const newNode: HistoryEntry = {
                    ...moveData,
                    children: [], // Ensure children array exists
                    id: moveData.id || createMoveId(),
                };
                current.children.push(newNode);
                current = newNode;
            });
        }
        setRootNode(root);
        setCurrentNodeId(current.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialFen]);


    const [isFlipped, setIsFlipped] = useState(false);
    const [selectedSquare, setSelectedSquare] = useState<ChessJSSquare | null>(null);
    const [promotionMove, setPromotionMove] = useState<{ from: ChessJSSquare; to: ChessJSSquare; } | null>(null);

    // Derive the current node and the path to it. This is the "main line" for the UI.
    const { currentNode, currentPath } = useMemo(() => {
        const path = findPathToNode(rootNode, currentNodeId);
        if (!path || path.length === 0) {
            console.error("Path/Node inconsistency. Resetting to root.");
            return { currentNode: rootNode, currentPath: [rootNode] };
        }
        return { currentNode: path[path.length - 1], currentPath: path };
    }, [rootNode, currentNodeId]);

    // Derive all other game state from the current node's FEN.
    const { currentBoard, turn, isGameOver, isCheckmate, isDraw, isCheck, possibleMoves } = useMemo(() => {
        const game = new Chess(currentNode.fen);
        const moves = selectedSquare ? game.moves({ square: selectedSquare, verbose: true }).map(m => m.to) : [];
        return {
            currentBoard: fenToBoardState(currentNode.fen).board,
            turn: game.turn() as PieceColor,
            isGameOver: game.isGameOver(),
            isCheckmate: game.isCheckmate(),
            isDraw: game.isDraw(),
            isCheck: game.isCheck(),
            possibleMoves: moves
        };
    }, [currentNode.fen, selectedSquare]);

    // This effect queues a checkmate sound when the game ends in checkmate.
    useEffect(() => {
        if (isCheckmate) {
            setSoundToPlay('CHECKMATE');
        }
    }, [isCheckmate]);

    // This is the reactive sound player. It triggers whenever `soundToPlay` is set,
    // plays the sound, and then immediately resets the state to null.
    useEffect(() => {
        if (soundToPlay) {
            soundManager.play(soundToPlay);
            setSoundToPlay(null);
        }
    }, [soundToPlay]);
    
    const gameStatus = useMemo(() => {
        if (isCheckmate) return `Checkmate! ${turn === 'w' ? 'Black' : 'White'} wins.`;
        if (isDraw) return 'Draw';
        if (isGameOver) return 'Game Over';
        return '';
    }, [isGameOver, isCheckmate, isDraw, turn]);

    const makeMove = useCallback((move: string | { from: ChessJSSquare, to: ChessJSSquare, promotion?: ChessJSPieceSymbol }): Move | null => {
        const tempGame = new Chess(currentNode.fen);
        let result: Move | null = null;
        try {
            result = tempGame.move(move);
        } catch (e) {
            setSelectedSquare(null);
            return null;
        }

        if (!result) return null;

        // For any valid move, queue the appropriate sound to be played after the state updates.
        setSoundToPlay(result.captured ? 'CAPTURE' : 'MOVE');

        // Check if this move already exists as a *non-archived* child.
        const existingChild = currentNode.children.find(child => !child.archived && child.san === result!.san);
        if (existingChild) {
            setCurrentNodeId(existingChild.id);
            setSelectedSquare(null);
            setPromotionMove(null);
            return result;
        }

        // It's a new move. Create the node for it.
        const newNode: HistoryEntry = {
            id: createMoveId(),
            fen: tempGame.fen(),
            san: result.san,
            from: result.from,
            to: result.to,
            color: result.color as PieceColor,
            captured: result.captured,
            promotion: result.promotion,
            children: [],
        };
        
        // --- IMMUTABLE UPDATE (Path-based, Copy-on-Write) ---
        // Handle the special case where we are branching from the root.
        if (currentNode.id === rootNode.id) {
            // If playing from the root, per user request, this move replaces the entire
            // game history and starts a new main line.
            const newRoot = {
                ...rootNode,
                children: [newNode]
            };
            setRootNode(newRoot);
            setCurrentNodeId(newNode.id);
        } else {
            // Find the path to the current node
            const path = findPathToNode(rootNode, currentNode.id);
            if (!path) {
                console.error("Could not find path to current node in move tree. State might be corrupt.");
                return null; // Should not happen
            }

            // Create a deep copy of the path and append the new node.
            // This is the core of the immutable update.
            // We start from the root and clone each node on the path.
            const newRoot = { ...rootNode }; // shallow clone root
            let currentNewNode = newRoot;
            // Iterate up to the parent of the node we're adding to.
            for (let i = 1; i < path.length; i++) {
                const pathNode = path[i];
                
                // Find the index of the next node in the path within the current node's children.
                const childIndex = currentNewNode.children.findIndex(child => child.id === pathNode.id);
                if (childIndex === -1) {
                    console.error("Path is broken. Aborting move.");
                    return null;
                }
                
                // Create a clone of that child.
                const newChild = { ...currentNewNode.children[childIndex] };

                // Replace the old child with the new clone in a new children array.
                currentNewNode.children = [
                    ...currentNewNode.children.slice(0, childIndex),
                    newChild,
                    ...currentNewNode.children.slice(childIndex + 1),
                ];
                
                // Move our reference pointer to the newly cloned child.
                currentNewNode = newChild;
            }

            // Now, `currentNewNode` is the cloned version of our `currentNode`. Add the new move to it.
            currentNewNode.children = [...currentNewNode.children, newNode];
            
            setRootNode(newRoot);
            setCurrentNodeId(newNode.id);
        }

        setSelectedSquare(null);
        setPromotionMove(null);

        return result;
    }, [currentNode, rootNode]);

    const makeRawMove = useCallback((move: { from: ChessJSSquare; to: ChessJSSquare; promotion?: ChessJSPieceSymbol }) => {
        return makeMove(move);
    }, [makeMove]);

    const handleSquareClick = useCallback((pos: { row: number; col: number }): Move | null => {
        if (isGameOver) return null;

        const square = (FILES[pos.col] + RANKS[7 - pos.row]) as ChessJSSquare;
        
        if (selectedSquare === square) {
            setSelectedSquare(null);
            return null;
        }

        if (selectedSquare) {
            const tempGame = new Chess(currentNode.fen);
            const move = tempGame.moves({ square: selectedSquare, verbose: true }).find(m => m.to === square);
            if (move) {
                if (move.flags.includes('p')) { // Is it a promotion move?
                    setPromotionMove({ from: move.from, to: move.to });
                    return null;
                } else {
                   return makeMove(move);
                }
            }
        }
        
        const piece = new Chess(currentNode.fen).get(square);
        if (piece && piece.color === turn) {
            setSelectedSquare(square);
        } else {
            setSelectedSquare(null);
        }
        return null;
    }, [isGameOver, currentNode.fen, turn, selectedSquare, makeMove]);

    const handlePromotion = useCallback((piece: ChessJSPieceSymbol | null): Move | null => {
        let result = null;
        if (promotionMove && piece) {
            result = makeMove({ ...promotionMove, promotion: piece });
        }
        setPromotionMove(null);
        return result;
    }, [promotionMove, makeMove]);
    
    const navigateHistory = useCallback((nodeId: string) => {
        setCurrentNodeId(nodeId);
        setSelectedSquare(null);
    }, []);
    
    const updateComment = useCallback((moveId: string, comment: string) => {
        const findAndUpdate = (node: HistoryEntry): HistoryEntry => {
            if (node.id === moveId) {
                const newComment = comment.trim() === '' ? undefined : comment.trim();
                return { ...node, comment: newComment };
            }
    
            let childrenUpdated = false;
            const newChildren = node.children.map(child => {
                const updatedChild = findAndUpdate(child);
                if (updatedChild !== child) {
                    childrenUpdated = true;
                }
                return updatedChild;
            });
    
            if (childrenUpdated) {
                return { ...node, children: newChildren };
            }
    
            return node;
        };
    
        const newRoot = findAndUpdate(rootNode);
    
        if (newRoot !== rootNode) {
            setRootNode(newRoot);
        }
    }, [rootNode]);
    
    const setBranchArchivedState = useCallback((moveId: string, isArchived: boolean) => {
        const findAndToggle = (node: HistoryEntry): HistoryEntry => {
            let childrenUpdated = false;
            const newChildren = node.children.map(child => {
                if (child.id === moveId) {
                    childrenUpdated = true;
                    // This is the node we're archiving/restoring.
                    // We return a new object with the updated 'archived' state.
                    return { ...child, archived: isArchived };
                }
                // Recursively check deeper children. Note: This simple traversal won't work
                // for nested variations. A full path-based reconstruction is needed.
                // For now, we only support archiving top-level variations.
                const updatedChild = findAndToggle(child);
                 if (updatedChild !== child) {
                    childrenUpdated = true;
                }
                return updatedChild;
            });
    
            if (childrenUpdated) {
                return { ...node, children: newChildren };
            }
    
            return node;
        };
    
        const newRoot = findAndToggle(rootNode);
    
        if (newRoot !== rootNode) {
            setRootNode(newRoot);
        }
    }, [rootNode]);

    const archiveBranch = useCallback((moveId: string) => {
        setBranchArchivedState(moveId, true);
    }, [setBranchArchivedState]);

    const restoreBranch = useCallback((moveId: string) => {
        setBranchArchivedState(moveId, false);
    }, [setBranchArchivedState]);

    return {
        game: new Chess(currentNode.fen), // Provide a fresh instance for inspection.
        rootNode,
        currentNode,
        currentPath,
        currentBoard,
        gameStatus,
        selectedSquare,
        possibleMoves,
        promotionMove,
        handleSquareClick,
        handlePromotion,
        navigateHistory,
        makeRawMove,
        updateComment,
        archiveBranch,
        restoreBranch,
        isGameOver,
        isCheckmate,
        isCheck,
        turn,
        isFlipped,
        setIsFlipped,
    };
};