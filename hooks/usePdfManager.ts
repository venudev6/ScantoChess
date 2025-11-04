/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useState, useCallback, useRef, useEffect } from 'react';
import { db } from '../lib/db';
import { generatePdfThumbnail } from '../lib/utils';
import type { AppState, StoredPdf, User } from '../lib/types';
import { authService } from '../lib/authService';

type SelectedPdfState = {
    id: number;
    file: File;
    lastPage: number;
    lastZoom: number;
};

type UsePdfManagerProps = {
    setAppState: (state: AppState) => void;
    setError: (error: string | null) => void;
    user: User | null;
};

/**
 * A custom hook to manage all interactions with the IndexedDB for storing and retrieving PDFs.
 * It centralizes the state and logic for the list of stored PDFs, the currently selected PDF,
 * and loading indicators.
 */
export const usePdfManager = ({ setAppState, setError, user }: UsePdfManagerProps) => {
    const [storedPdfs, setStoredPdfs] = useState<StoredPdf[]>([]);
    const [isProcessingPdf, setIsProcessingPdf] = useState(false);
    const [selectedPdf, setSelectedPdf] = useState<SelectedPdfState | null>(null);

    const loadStoredPdfs = useCallback(async () => {
        try {
            await db.init();
            const pdfs = await db.getAllPdfs();
            setStoredPdfs(pdfs);
        } catch (e) {
            console.error("Could not load stored PDFs:", e);
        }
    }, []);
    
    useEffect(() => {
        loadStoredPdfs();
    }, [loadStoredPdfs]);


    const clearSelectedPdf = useCallback(() => {
        setSelectedPdf(null);
    }, []);

    const handlePdfSelect = async (file: File): Promise<number | undefined> => {
        setIsProcessingPdf(true);
        try {
            const thumbnail = await generatePdfThumbnail(file);
            const newId = await db.savePdf(file, thumbnail);
            
            await loadStoredPdfs();

            setSelectedPdf({ id: newId, file, lastPage: 1, lastZoom: 1.0 });
            setAppState('pdfViewer');
            return newId;
        } catch (e) {
            console.error("Error saving PDF:", e);
            setError("Could not save the PDF file.");
            setAppState('error');
        } finally {
            setIsProcessingPdf(false);
        }
    };

    const handleStoredPdfSelect = async (id: number) => {
        setIsProcessingPdf(true);
        try {
            const record = await db.getPdf(id);
            const pageToOpen = record.lastPage || 1;

            setSelectedPdf({
                id: record.id,
                file: record.data,
                lastPage: pageToOpen,
                lastZoom: record.lastZoom || 1.0,
            });
            setAppState('pdfViewer');
        } catch (e) {
            console.error("Error loading stored PDF:", e);
            setError("Could not load the selected PDF file.");
            setAppState('error');
        } finally {
            setIsProcessingPdf(false);
        }
    };
    
    const handleDeletePdf = async (id: number) => {
        try {
            await db.deletePdf(id);
            await loadStoredPdfs();
        } catch(e) {
            console.error("Could not delete PDF:", e);
        }
    };

    const handlePdfStateChange = useCallback(async (id: number, page: number, zoom: number) => {
        setSelectedPdf(prev => {
            if (prev && prev.id === id) {
                return { ...prev, lastPage: page, lastZoom: zoom };
            }
            return prev;
        });
    
        try {
            await db.updatePdfState(id, page, zoom);
        } catch (e) {
            console.error("Failed to update PDF state:", e);
        }
    }, []);

    return {
        storedPdfs,
        isProcessingPdf,
        selectedPdf,
        loadStoredPdfs,
        handlePdfSelect,
        handleStoredPdfSelect,
        handleDeletePdf,
        handlePdfStateChange,
        clearSelectedPdf,
    };
};