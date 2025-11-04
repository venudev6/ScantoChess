/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useCallback, useEffect, useRef, useState, memo, useLayoutEffect } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { useInView } from "react-intersection-observer";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import {
  BackIcon,
  NextMoveIcon,
  PrevMoveIcon,
  DeepScanIcon,
  FitToWidthIcon,
  FitPageIcon,
  OptionsIcon,
  ZoomInIcon,
  ZoomOutIcon,
  CheckIcon,
  CloseIcon
} from "../ui/Icons";
import { usePdfDeepScan } from "../../hooks/usePdfDeepScan";
import { resizeAndExportImage } from "../../lib/utils";
import type { DetectedPuzzle, BoundingBox } from "../../lib/types";
import { db } from "../../lib/db";
import "./PdfView.css";

const runtimeVersion = (pdfjsLib as any)?.version || "4.10.38";
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://aistudiocdn.com/pdfjs-dist@${runtimeVersion}/build/pdf.worker.mjs`;

const PAGE_BUFFER = 2; // Pre-render 2 pages before and after the current one

type CropBox = { x: number; y: number; width: number; height: number };
type CropMode = "idle" | "drawing" | "moving" | "resizing";
type ResizeHandle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "w" | "e";

function debounce<F extends (...args: any[]) => any>(func: F, wait: number): (...args: Parameters<F>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return function(this: any, ...args: Parameters<F>) {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      func.apply(this, args);
    }, wait);
  };
}

/**
 * Expands a bounding box by a given percentage in all directions, clamping to the 0-1 range.
 * @param box The original bounding box with x, y, width, height as percentages (0-1).
 * @param percent The percentage to expand by (e.g., 0.01 for 1%).
 * @returns The new, expanded bounding box.
 */
const expandBox = (box: BoundingBox, percent: number): BoundingBox => {
    const newX = Math.max(0, box.x - percent);
    const newY = Math.max(0, box.y - percent);
    const newWidth = Math.min(1 - newX, box.width + (percent * 2));
    const newHeight = Math.min(1 - newY, box.height + (percent * 2));
    return { x: newX, y: newY, width: newWidth, height: newHeight };
};


interface PdfViewProps {
  pdfId: number;
  pdfFile: File;
  initialPage?: number;
  initialZoom?: number;
  onCropConfirm: (file: File, context: { page: number; totalPages: number }, clientProcessingTime: number) => void;
  onBack: () => void;
  onStateChange?: (id: number, page: number, zoom: number) => void;
  onPreScannedPuzzleFound?: (fen: string) => void;
}

// Virtualized Page Renderer
const PageRenderer = memo(({ pdfDoc, pageNumber, scale, isVisible, puzzles, onPuzzleClick, placeholderHeight, placeholderWidth }: {
  pdfDoc: PDFDocumentProxy | null,
  pageNumber: number,
  scale: number,
  isVisible: boolean,
  puzzles: DetectedPuzzle[],
  onPuzzleClick: (puzzle: DetectedPuzzle, pageNum: number) => void,
  placeholderHeight: number,
  placeholderWidth: number
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { ref, inView } = useInView({ rootMargin: '500px 0px', triggerOnce: true });
    const renderTaskRef = useRef<RenderTask | null>(null);

    useEffect(() => {
        let isEffectCancelled = false;
        let pageProxy: PDFPageProxy | null = null;
        let renderTask: RenderTask | null = null;
        
        // Always cancel the previous render task before starting a new one.
        if (renderTaskRef.current) {
            renderTaskRef.current.cancel();
        }

        const canvas = canvasRef.current;
        if ((inView || isVisible) && pdfDoc && canvas) {
            pdfDoc.getPage(pageNumber).then(page => {
                if (isEffectCancelled) {
                    page.cleanup();
                    return;
                }
                pageProxy = page;
                const viewport = page.getViewport({ scale, rotation: page.rotate });
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                if (context) {
                    const renderContext = { canvasContext: context, viewport: viewport };
                    renderTask = page.render(renderContext as any);
                    renderTaskRef.current = renderTask;

                    renderTask.promise.catch(error => {
                        if (isEffectCancelled || error?.name === 'RenderingCancelledException') {
                            return; // Ignore cancellation errors gracefully.
                        }
                        console.error(`Page render error (page ${pageNumber}):`, error);
                    }).finally(() => {
                        // Only nullify the ref if this is the task that actually finished/was cancelled.
                        // This prevents a fast re-render from nullifying a new task's ref.
                        if (renderTaskRef.current === renderTask) {
                            renderTaskRef.current = null;
                        }
                    });
                }
            });
        }
        
        return () => { 
            isEffectCancelled = true;
            if (renderTaskRef.current) {
                renderTaskRef.current.cancel();
                renderTaskRef.current = null;
            }
            if (pageProxy) {
                // pageProxy might not be set if getPage hasn't resolved yet
                // when cleanup runs.
                pageProxy.cleanup();
            }
        };
    }, [inView, isVisible, pdfDoc, pageNumber, scale]);

    return (
        <div ref={ref} className="pdf-page-container" style={{ minHeight: placeholderHeight, minWidth: placeholderWidth }}>
            <canvas ref={canvasRef} />
            {(puzzles || []).map((puzzle, index) => {
                // Expand the tight bounding box by 1% for UI display to prevent overlap.
                const uiBox = expandBox(puzzle.boundingBox, 0.01);
                return (
                    <div 
                        key={index} 
                        className="puzzle-overlay" 
                        style={{ left: `${uiBox.x*100}%`, top: `${uiBox.y*100}%`, width: `${uiBox.width*100}%`, height: `${uiBox.height*100}%` }} 
                        onClick={(e) => { e.stopPropagation(); onPuzzleClick?.(puzzle, pageNumber); }}
                    >
                        <span className="corner-marker top-left"></span>
                        <span className="corner-marker top-right"></span>
                        <span className="corner-marker bottom-left"></span>
                        <span className="corner-marker bottom-right"></span>
                    </div>
                );
            })}
        </div>
    );
});

const ThumbRenderer = memo(({ pdfDoc, pageNumber, currentPage, onClick, thumb, onThumbGenerated }: {
  pdfDoc: PDFDocumentProxy | null;
  pageNumber: number;
  currentPage: number;
  onClick: () => void;
  thumb: string | undefined;
  onThumbGenerated: (pageNum: number, dataUrl: string) => void;
}) => {
  const { ref, inView } = useInView({ rootMargin: '400px 0px', triggerOnce: true });
  const renderTaskRef = useRef<RenderTask | null>(null);
  const hasGenerated = useRef(false);

  useEffect(() => {
    let isEffectCancelled = false;
    let renderTask: RenderTask | null = null;
    let pageProxy: PDFPageProxy | null = null;

    if (inView && pdfDoc && !thumb && hasGenerated.current === false) {
      hasGenerated.current = true;
      
      // Cancel any stray task before starting.
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      pdfDoc.getPage(pageNumber).then(page => {
          if (isEffectCancelled) {
            page.cleanup();
            return;
          }
          pageProxy = page;
          const canvas = document.createElement("canvas");
          const viewport = page.getViewport({ scale: 0.2, rotation: page.rotate });
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
              const renderContext = { canvasContext: ctx, viewport: viewport };
              renderTask = page.render(renderContext as any);
              renderTaskRef.current = renderTask;

              renderTask.promise.then(() => {
                  if (!isEffectCancelled) {
                    onThumbGenerated(pageNumber, canvas.toDataURL("image/jpeg", 0.7));
                  }
              }).catch(err => {
                  if (!isEffectCancelled && err?.name !== 'RenderingCancelledException') {
                    console.error(`Error rendering thumb ${pageNumber}:`, err);
                  }
              }).finally(() => {
                  if (renderTaskRef.current === renderTask) {
                    renderTaskRef.current = null;
                  }
              });
          }
      });
    }

    return () => {
        isEffectCancelled = true;
        if (renderTaskRef.current) {
            renderTaskRef.current.cancel();
            renderTaskRef.current = null;
        }
        if (pageProxy) {
            pageProxy.cleanup();
        }
    };
  }, [inView, pdfDoc, thumb, pageNumber, onThumbGenerated]);

  return (
    <div ref={ref} className={`pdf-thumb-item ${currentPage === pageNumber ? "active" : ""}`} onClick={onClick}>
      {thumb ? <img src={thumb} alt={`Page ${pageNumber}`} className="pdf-thumb-img" /> : <div className="pdf-thumb-placeholder">{pageNumber}</div>}
      <div className="pdf-thumb-page-number">{pageNumber}</div>
    </div>
  );
});

const PdfView: React.FC<PdfViewProps> = ({
  pdfId, pdfFile, initialPage = 1, initialZoom = 1.0, onCropConfirm, onBack,
  onStateChange, onPreScannedPuzzleFound,
}) => {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [pageInput, setPageInput] = useState(String(initialPage));
  const [thumbs, setThumbs] = useState<Map<number, string>>(new Map());
  const [isDocLoading, setIsDocLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(initialZoom);
  const [pageViewport, setPageViewport] = useState<{width: number, height: number} | null>(null);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  
  const mainViewRef = useRef<HTMLDivElement>(null);
  const optionsMenuRef = useRef<HTMLDivElement>(null);
  const pageWrapperRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const thumbRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  
  const { isDeepScanning, scanProgress, startDeepScan, cancelDeepScan } = usePdfDeepScan(pdfDoc, pdfId);
  const [scannedPuzzles, setScannedPuzzles] = useState<Map<number, DetectedPuzzle[]>>(new Map());
  const [scannedPages, setScannedPages] = useState<Set<number>>(new Set());

  const [isConfirming, setIsConfirming] = useState(false);
  const [cropBox, setCropBox] = useState<CropBox | null>(null);
  const [cropMode, setCropMode] = useState<CropMode>('idle');
  const [activeResizeHandle, setActiveResizeHandle] = useState<ResizeHandle | null>(null);
  const startDragPoint = useRef({ x: 0, y: 0 });
  const originalCropBox = useRef<CropBox | null>(null);
  const justFinishedDrawing = useRef(false);
  const [targetScroll, setTargetScroll] = useState<{ left: number; top: number } | null>(null);

  const isScrollingProgrammatically = useRef(false);
  const scrollTimeout = useRef<any>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (optionsMenuRef.current && !optionsMenuRef.current.contains(event.target as Node)) {
            setIsOptionsOpen(false);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const url = URL.createObjectURL(pdfFile);
    setIsDocLoading(true);
    setError(null);
    setPdfDoc(null);
    setNumPages(0);

    const loadingTask = pdfjsLib.getDocument(url);
    loadingTask.promise.then(async (pdf) => {
        setPdfDoc(pdf);
        setNumPages(pdf.numPages);
        
        const firstPage = await pdf.getPage(1);
        const viewport = firstPage.getViewport({ scale: 1, rotation: firstPage.rotate });
        setPageViewport({ width: viewport.width, height: viewport.height });
        
        // If a specific zoom was passed (e.g., from DB), use it. Otherwise, calculate a smart default.
        if (initialZoom && initialZoom !== 1.0) {
            setZoom(initialZoom);
        } else {
            // Wait a tick for the main view ref to be available for calculations.
            setTimeout(() => {
                if (mainViewRef.current) {
                    const isMobile = window.innerWidth <= 768;
                    if (isMobile) {
                        // Fit to width for mobile
                        const containerWidth = mainViewRef.current.clientWidth - 48; // -48 for padding
                        setZoom(containerWidth / viewport.width);
                    } else {
                        // Fit page for desktop
                        const containerWidth = mainViewRef.current.clientWidth - 48;
                        const containerHeight = mainViewRef.current.clientHeight - 48;
                        const scaleX = containerWidth / viewport.width;
                        const scaleY = containerHeight / viewport.height;
                        setZoom(Math.min(scaleX, scaleY));
                    }
                }
            }, 0);
        }
        
        firstPage.cleanup();
        setIsDocLoading(false);
    }).catch(error => {
        console.error("Error loading PDF:", error);
        setError("Failed to load PDF document.");
        setIsDocLoading(false);
    }).finally(() => {
        URL.revokeObjectURL(url);
    });

    return () => {
        loadingTask.destroy();
    };
  }, [pdfFile, initialZoom]);
  
  const scrollToPage = useCallback((pageNumber: number, behavior: 'smooth' | 'auto' = 'smooth') => {
    const pageEl = pageWrapperRefs.current.get(pageNumber);
    if (pageEl && mainViewRef.current) {
        isScrollingProgrammatically.current = true;
        mainViewRef.current.scrollTo({ top: pageEl.offsetTop - 24, behavior });
        setCurrentPage(pageNumber);
        setPageInput(String(pageNumber));
        clearTimeout(scrollTimeout.current);
        scrollTimeout.current = setTimeout(() => { isScrollingProgrammatically.current = false; }, behavior === 'smooth' ? 500 : 50);
    }
  }, []);

  useEffect(() => {
    if (!isDocLoading && pdfDoc) {
      const timer = setTimeout(() => {
        scrollToPage(initialPage, 'auto');
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isDocLoading, pdfDoc, initialPage, scrollToPage]);

  
  const debouncedOnStateChange = useRef(debounce((id: number, page: number, z: number) => { onStateChange?.(id, page, z); }, 1000)).current;

  useEffect(() => {
    if (!isDocLoading) {
        debouncedOnStateChange(pdfId, currentPage, zoom);
    }
  }, [pdfId, currentPage, zoom, onStateChange, isDocLoading, debouncedOnStateChange]);

  const handleScroll = useCallback(() => {
    if (isScrollingProgrammatically.current || !mainViewRef.current) return;
    clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
        const view = mainViewRef.current!;
        const viewCenter = view.scrollTop + view.clientHeight / 2;
        let bestVisiblePage = currentPage;
        let minDistance = Infinity;
        pageWrapperRefs.current.forEach((el, pageNum) => {
            if (el) {
                const distance = Math.abs((el.offsetTop + el.clientHeight / 2) - viewCenter);
                if (distance < minDistance) {
                    minDistance = distance;
                    bestVisiblePage = pageNum;
                }
            }
        });
        if (bestVisiblePage !== currentPage) {
            setCurrentPage(bestVisiblePage);
            setPageInput(String(bestVisiblePage));
            thumbRefs.current.get(bestVisiblePage)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, 150);
  }, [currentPage]);
  
  const handlePagePointerDown = (e: React.PointerEvent<HTMLDivElement>, pageNum: number) => {
    if (e.button !== 0 || currentPage !== pageNum || isDeepScanning || isConfirming) return;

    const target = e.target as HTMLElement;
    if (target.closest('.crop-box') || target.closest('.puzzle-overlay')) {
      return;
    }

    const pageWrapper = pageWrapperRefs.current.get(currentPage);
    if (!pageWrapper) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    setCropBox(null);

    const rect = pageWrapper.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    startDragPoint.current = { x, y };
    const newCropBox = { x, y, width: 0, height: 0 };
    setCropBox(newCropBox);
    originalCropBox.current = newCropBox;
    setCropMode('drawing');
  };
  
  useEffect(() => {
    if (cropMode === 'idle' || isDocLoading) return;

    const pageWrapper = pageWrapperRefs.current.get(currentPage);
    if (!pageWrapper) return;
    const rect = pageWrapper.getBoundingClientRect();

    const handlePointerMove = (e: PointerEvent) => {
        e.preventDefault();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;

        if (cropMode === 'drawing') {
            const startX = startDragPoint.current.x;
            const startY = startDragPoint.current.y;
            setCropBox({
                x: Math.min(startX, currentX),
                y: Math.min(startY, currentY),
                width: Math.abs(currentX - startX),
                height: Math.abs(currentY - startY),
            });
        } else if (originalCropBox.current) {
            const dx = currentX - startDragPoint.current.x;
            const dy = currentY - startDragPoint.current.y;
            let newBox = { ...originalCropBox.current };

            if (cropMode === 'moving') {
                newBox.x += dx;
                newBox.y += dy;
            } else if (cropMode === 'resizing' && activeResizeHandle) {
                if (activeResizeHandle.includes('n')) { newBox.y += dy; newBox.height -= dy; }
                if (activeResizeHandle.includes('s')) { newBox.height += dy; }
                if (activeResizeHandle.includes('w')) { newBox.x += dx; newBox.width -= dx; }
                if (activeResizeHandle.includes('e')) { newBox.width += dx; }
            }

            newBox.x = Math.max(0, newBox.x);
            newBox.y = Math.max(0, newBox.y);
            if (newBox.x + newBox.width > pageWrapper.clientWidth) {
                newBox.width = pageWrapper.clientWidth - newBox.x;
            }
            if (newBox.y + newBox.height > pageWrapper.clientHeight) {
                newBox.height = pageWrapper.clientHeight - newBox.y;
            }
            setCropBox(newBox);
        }
    };

    const handlePointerUp = () => {
        setCropMode('idle');
        setActiveResizeHandle(null);
        originalCropBox.current = null;
        justFinishedDrawing.current = true;
        setCropBox(prevBox => {
            if (!prevBox) return null;
            const newBox = { ...prevBox };
            if (newBox.width < 0) {
                newBox.x = newBox.x + newBox.width;
                newBox.width = Math.abs(newBox.width);
            }
            if (newBox.height < 0) {
                newBox.y = newBox.y + newBox.height;
                newBox.height = Math.abs(newBox.height);
            }
            if (newBox.width < 10 || newBox.height < 10) {
                return null;
            }
            return newBox;
        });
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });

    return () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [cropMode, activeResizeHandle, currentPage, isDocLoading]);

  useEffect(() => {
    if (justFinishedDrawing.current && cropBox && mainViewRef.current) {
        justFinishedDrawing.current = false; // Consume the flag

        const isMobile = window.innerWidth <= 768;
        if (!isMobile) return;

        if (cropBox.width < 20 || cropBox.height < 20) return;
        
        const container = mainViewRef.current;
        const padding = 40; // 20px on each side
        const targetWidth = container.clientWidth - padding;

        if (cropBox.width === 0) return;
        
        const zoomFactor = targetWidth / cropBox.width;
        const newZoom = Math.min(zoom * zoomFactor, 5.0); // Cap max zoom

        const newCropX = cropBox.x * (newZoom / zoom);
        const newCropWidth = cropBox.width * (newZoom / zoom);
        const newCropY = cropBox.y * (newZoom / zoom);
        
        const scrollLeft = newCropX + (newCropWidth / 2) - (container.clientWidth / 2);
        const scrollTop = newCropY - 20;

        setTargetScroll({ left: scrollLeft, top: scrollTop });
        setZoom(newZoom);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropBox, zoom]);

  useLayoutEffect(() => {
    if (targetScroll && mainViewRef.current) {
        mainViewRef.current.scrollTo({
            left: targetScroll.left,
            top: targetScroll.top,
            behavior: 'smooth'
        });
        setTargetScroll(null); // Reset after scrolling
    }
  }, [targetScroll]);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            setCropBox(null);
            setCropMode('idle');
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleConfirmCrop = useCallback(async (boxToCrop?: CropBox) => {
    const box = boxToCrop || cropBox;
    if (!pdfDoc || !box || box.width < 10 || box.height < 10) return;
    setIsConfirming(true);
    const startTime = performance.now();
    let page: PDFPageProxy | null = null;
    try {
        page = await pdfDoc.getPage(currentPage);
        const CROP_SCALE = 2.0;
        const pageViewportForRender = page.getViewport({ scale: CROP_SCALE, rotation: page.rotate });

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = pageViewportForRender.width;
        tempCanvas.height = pageViewportForRender.height;
        const ctx = tempCanvas.getContext('2d');

        if (ctx) {
            await page.render({ canvasContext: ctx, viewport: pageViewportForRender } as any).promise;

            const finalCanvas = document.createElement('canvas');
            const actualPageViewport = page.getViewport({ scale: zoom, rotation: page.rotate });
            const scaleRatio = pageViewportForRender.width / actualPageViewport.width;

            const boxWidthPx = box.width * scaleRatio;
            const boxHeightPx = box.height * scaleRatio;
            finalCanvas.width = boxWidthPx;
            finalCanvas.height = boxHeightPx;
            const finalCtx = finalCanvas.getContext('2d');
            
            if (finalCtx) {
                finalCtx.drawImage(
                    tempCanvas,
                    box.x * scaleRatio, box.y * scaleRatio,
                    boxWidthPx, boxHeightPx,
                    0, 0,
                    boxWidthPx, boxHeightPx
                );
                
                const croppedFile = await resizeAndExportImage(finalCanvas, { maxDimension: 800, type: "image/webp", quality: 0.8, fileName: "cropped-puzzle.webp" });
                if (croppedFile) {
                    onCropConfirm(croppedFile, { page: currentPage, totalPages: numPages }, performance.now() - startTime);
                }
            }
        }
        setCropBox(null);
    } catch (e) {
        console.error("Error confirming crop", e);
        setError("Could not process the selected crop.");
    } finally {
        setIsConfirming(false);
        page?.cleanup();
    }
  }, [pdfDoc, cropBox, currentPage, numPages, onCropConfirm, zoom]);

  const handleThumbGenerated = useCallback((pageNum: number, dataUrl: string) => { setThumbs(prev => new Map(prev).set(pageNum, dataUrl)); }, []);
  
  const handleThumbClick = (pageNumber: number) => { scrollToPage(pageNumber); };
  const prevPage = () => handleThumbClick(Math.max(1, currentPage - 1));
  const nextPage = () => handleThumbClick(Math.min(numPages, currentPage + 1));

  const onPageInputBlur = () => {
    const pageNum = parseInt(pageInput, 10);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= numPages) {
        scrollToPage(pageNum);
    } else {
        setPageInput(String(currentPage));
    }
  };
  
  useEffect(() => {
      const loadPuzzles = async () => {
          if (pdfDoc && !scannedPuzzles.has(currentPage)) {
              const puzzles = await db.getPdfPuzzles(pdfId, currentPage);
              if (puzzles) { // Puzzles can exist with an empty array if scan found nothing
                  setScannedPuzzles(prev => new Map(prev).set(currentPage, puzzles.puzzles));
                  setScannedPages(prev => new Set(prev).add(currentPage));
              }
          }
      };
      loadPuzzles();
  }, [currentPage, pdfDoc, pdfId, scannedPuzzles]);

  const handleDeepScan = async () => {
      await startDeepScan(currentPage, (puzzles) => {
          setScannedPuzzles(prev => new Map(prev).set(currentPage, puzzles));
          setScannedPages(prev => new Set(prev).add(currentPage));
      });
  };
  
  const handlePuzzleClick = useCallback((puzzle: DetectedPuzzle, pageNum: number) => {
    if (onPreScannedPuzzleFound && puzzle.fen) {
        onPreScannedPuzzleFound(puzzle.fen);
    } else {
        const pageWrapper = pageWrapperRefs.current.get(pageNum);
        const canvas = pageWrapper?.querySelector('canvas');
        if(!pageWrapper || !canvas) return;

        // Use a 1% expansion for the initial crop box to match the UI overlay
        const uiBox = expandBox(puzzle.boundingBox, 0.01);

        const boxToCrop: CropBox = {
            x: uiBox.x * canvas.clientWidth,
            y: uiBox.y * canvas.clientHeight,
            width: uiBox.width * canvas.clientWidth,
            height: uiBox.height * canvas.clientHeight
        };
        justFinishedDrawing.current = true;
        setCropBox(boxToCrop);
    }
  }, [onPreScannedPuzzleFound]);
  
  const changeZoom = useCallback((newZoomCallback: (prevZoom: number) => number) => { setZoom(prevZoom => Math.max(0.25, Math.min(newZoomCallback(prevZoom), 5.0))); }, []);
  
  const handleFitWidth = useCallback(async () => {
    if (!pdfDoc || !mainViewRef.current) return;
    try {
      const page = await pdfDoc.getPage(currentPage);
      const containerWidth = mainViewRef.current.clientWidth - 48; // Account for padding
      const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
      setZoom(containerWidth / viewport.width);
      page.cleanup();
      setIsOptionsOpen(false);
    } catch (e) { console.error("Failed to fit width:", e); }
  }, [pdfDoc, currentPage]);
  
  const handleFitPage = useCallback(async () => {
    if (!pdfDoc || !mainViewRef.current) return;
    try {
        const page = await pdfDoc.getPage(currentPage);
        const containerWidth = mainViewRef.current.clientWidth - 48;
        const containerHeight = mainViewRef.current.clientHeight - 48;
        const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
        const scaleX = containerWidth / viewport.width;
        const scaleY = containerHeight / viewport.height;
        setZoom(Math.min(scaleX, scaleY));
        page.cleanup();
        setIsOptionsOpen(false);
    } catch (e) { console.error("Failed to fit page:", e); }
  }, [pdfDoc, currentPage]);
  
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => { if (e.ctrlKey) { e.preventDefault(); changeZoom(z => z - e.deltaY * 0.005); }};
  
  const handleCropActionPointerDown = (e: React.PointerEvent, mode: 'moving' | 'resizing', handle?: ResizeHandle) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const pageWrapper = pageWrapperRefs.current.get(currentPage);
    if (!pageWrapper) return;
    
    const rect = pageWrapper.getBoundingClientRect();
    startDragPoint.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    originalCropBox.current = cropBox;
    setCropMode(mode);
    if (handle) {
        setActiveResizeHandle(handle);
    }
  };
  
  const isPageScanned = scannedPages.has(currentPage);

  if (error) return <div className="card error-container" style={{justifyContent: 'center'}}><h3>Error Loading PDF</h3><p>{error}</p><button className="btn btn-primary" onClick={onBack}>Go Back</button></div>;

  return (
    <div className="pdf-viewer-container">
      <div className="pdf-toolbar">
        <div className="pdf-toolbar-left">
          <button className="btn-icon" onClick={onBack} title="Back"><BackIcon /></button>
        </div>
        <div className="pdf-toolbar-center">
            <div className={`pdf-toolbar-group ${isOptionsOpen ? 'dropdown-active' : ''}`}>
                <button className="btn-icon" onClick={handleDeepScan} disabled={isDeepScanning} title={isPageScanned ? "Page Scanned" : "Deep Scan page for puzzles"}>{isDeepScanning ? <div className="spinner-small" /> : isPageScanned ? <CheckIcon/> : <DeepScanIcon />}</button>
                <div className="options-menu-container" ref={optionsMenuRef}>
                    <button className="btn-icon" onClick={() => setIsOptionsOpen(o => !o)} title="View Options">
                        <OptionsIcon />
                    </button>
                    {isOptionsOpen && (
                        <div className="options-dropdown">
                            <button onClick={handleFitWidth}><FitToWidthIcon /> <span>Fit to Width</span></button>
                            <button onClick={handleFitPage}><FitPageIcon /> <span>Fit to Page</span></button>
                        </div>
                    )}
                </div>
            </div>
            <div className="pdf-toolbar-group">
              <button className="btn-icon" onClick={() => changeZoom(z => z / 1.25)} title="Zoom Out"><ZoomOutIcon/></button>
              <button className="btn-icon" onClick={() => changeZoom(z => z * 1.25)} title="Zoom In"><ZoomInIcon/></button>
            </div>
            <div className="pdf-toolbar-group">
              <button className="btn-icon" onClick={prevPage} disabled={currentPage <= 1}><PrevMoveIcon /></button>
              <div className="page-input-container">
                  <input className="page-input" value={pageInput} onChange={(e) => setPageInput(e.target.value)} onBlur={onPageInputBlur} onKeyDown={(e) => e.key === "Enter" && onPageInputBlur()} />
                  <span className="page-total">/ {numPages || "..."}</span>
              </div>
              <button className="btn-icon" onClick={nextPage} disabled={currentPage >= numPages}><NextMoveIcon /></button>
            </div>
        </div>
        <div className="pdf-toolbar-right">
            {/* Empty div for spacing balance */}
        </div>
      </div>
      <div className="pdf-body">
        <aside className="pdf-filmstrip" style={{ width: 120 }}><div className="pdf-filmstrip-scroller">{isDocLoading && <div className="thumb-loading">Loading PDF...</div>}{Array.from({ length: numPages }, (_, i) => i + 1).map(pageNumber => (<div key={`thumb_wrapper_${pageNumber}`} ref={el => { thumbRefs.current.set(pageNumber, el); }}><ThumbRenderer pdfDoc={pdfDoc} thumb={thumbs.get(pageNumber)} onThumbGenerated={handleThumbGenerated} pageNumber={pageNumber} currentPage={currentPage} onClick={() => handleThumbClick(pageNumber)} /></div>))}</div></aside>
        <div className={`pdf-main-view ${cropMode !== 'idle' ? 'cropping-active' : ''}`} ref={mainViewRef} onScroll={handleScroll} onWheel={handleWheel}>
          {(isDocLoading) && (<div className="pdf-loading-overlay"><div className="spinner" /><p>Loading PDF...</p></div>)}
          {!isDocLoading && pdfDoc && (<div className="pdf-main-view-scroller">{pageViewport && Array.from({ length: numPages }, (_, i) => i + 1).map(pageNumber => { const isVisible = Math.abs(pageNumber - currentPage) <= PAGE_BUFFER; return (<div data-page-number={pageNumber} key={`wrapper_${pageNumber}`} ref={el => { pageWrapperRefs.current.set(pageNumber, el); }} className="pdf-page-wrapper" onPointerDown={e => handlePagePointerDown(e, pageNumber)}><PageRenderer pdfDoc={pdfDoc} pageNumber={pageNumber} scale={zoom} isVisible={isVisible} puzzles={scannedPuzzles.get(pageNumber) || []} onPuzzleClick={handlePuzzleClick} placeholderHeight={pageViewport.height * zoom} placeholderWidth={pageViewport.width * zoom} /> {isDeepScanning && currentPage === pageNumber && (
            <div className="pdf-page-scan-overlay">
                <div className="spinner" />
                <p>{scanProgress?.message || "Scanning..."}</p>
                {scanProgress?.total > 0 && <progress value={scanProgress.current} max={scanProgress.total} />}
                <button onClick={cancelDeepScan} className="btn btn-secondary">Cancel</button>
            </div>
          )} {currentPage === pageNumber && (<div className="pdf-crop-layer">{cropBox && cropBox.width > 5 && cropBox.height > 5 && (
            <div className="crop-box" style={{ left: cropBox.x, top: cropBox.y, width: cropBox.width, height: cropBox.height }} onPointerDown={(e) => handleCropActionPointerDown(e, 'moving')}>
                {(["nw", "ne", "sw", "se", "n", "s", "w", "e"] as ResizeHandle[]).map(handle => ( <div key={handle} className={`resize-handle resize-handle-${handle}`} onPointerDown={(e) => handleCropActionPointerDown(e, 'resizing', handle)}/>))}
                <div className="crop-actions">
                    <button className="btn-icon btn-confirm" onClick={() => handleConfirmCrop()} disabled={isConfirming} onPointerDown={e => e.stopPropagation()}>
                        {isConfirming ? <div className="spinner-small"></div> : <CheckIcon />}
                    </button>
                    <button className="btn-icon" onClick={() => setCropBox(null)} onPointerDown={e => e.stopPropagation()}>
                        <CloseIcon />
                    </button>
                </div>
            </div>
          )}</div>)}</div>);})}</div>)}
        </div>
      </div>
    </div>
  );
};

export default PdfView;