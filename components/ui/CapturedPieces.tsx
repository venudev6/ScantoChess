/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React from 'react';
import type { BoardPiece, PieceColor } from '../../lib/types';
import { PIECE_SETS, PIECE_NAMES, PIECE_VALUES } from '../../lib/chessConstants';
import './CapturedPieces.css';

interface CapturedPiecesProps {
    color: PieceColor,
    pieces: BoardPiece[],
    scoreAdvantage: number,
    pieceTheme: string;
    displayMode?: 'panel' | 'inline';
}

/**
 * A UI component to display a list of captured pieces for one side,
 * along with the material advantage score for the opponent.
 *
 * @param props - The component's properties.
 */
const CapturedPieces = ({ color, pieces, scoreAdvantage, pieceTheme, displayMode = 'panel' }: CapturedPiecesProps) => {
    // Determine the title based on the color of the captured pieces.
    const title = color === 'w' ? 'White pieces captured' : 'Black pieces captured';
    const PIECE_COMPONENTS = PIECE_SETS[pieceTheme as keyof typeof PIECE_SETS] || PIECE_SETS['merida'];
    const advantageEl = scoreAdvantage > 0 && <span className="advantage">+{scoreAdvantage}</span>;
    
    // Sort pieces by value, lowest to highest (pawn first).
    const sortedPieces = [...pieces].sort((a, b) => PIECE_VALUES[a.type] - PIECE_VALUES[b.type]);

    return (
        // The main container div. The class changes based on the color for specific styling.
        // The layout is now a single flex row.
        <div className={`captured-pieces captured-pieces-${color} display-mode-${displayMode}`}>
            {/* For black pieces (left), show score first */}
            {color === 'b' && advantageEl}
            <div className="captured-pieces-display">
                {/* 
                  If there are captured pieces, map over the array and render each piece's SVG component.
                  Otherwise, display the title as a placeholder if in 'panel' mode.
                */}
                {sortedPieces.length > 0 ? sortedPieces.map((p, i) => {
                    const PieceComponent = PIECE_COMPONENTS[p.color][p.type];
                    return (
                        <PieceComponent
                            key={i} 
                            className="piece"
                            aria-label={`${p.color === 'w' ? 'White' : 'Black'} ${PIECE_NAMES[p.type]}`}
                        />
                    );
                }) : (
                    displayMode === 'panel' && <span className="no-pieces">{title}</span>
                )}
            </div>
             {/* For white pieces (right), show score last */}
            {color === 'w' && advantageEl}
        </div>
    )
};

export default CapturedPieces;