/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useCallback, useEffect, useRef, useState, memo, useLayoutEffect, useMemo } from "react";
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

// --- Module-level PDF cache to avoid reload flicker ---
const pdfCache = new Map<string, { doc: PDFDocumentProxy; lastUsed: number; destroyTimer?: number }>();

function fileFingerprint(file: File) {
  return `${file.name}_${file.size}_${(file as any).lastModified ?? 0}`;
}

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
  const [pageViewports, setPageViewports] = useState<Map<number, {width: number, height: number}>>(new Map());
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [filmstripNode, setFilmstripNode] = useState<HTMLDivElement | null>(null);
  
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
  
  const scrollRestoreRef = useRef<{ page: number, ratio: number } | null>(null);
  const isScrollingProgrammatically = useRef(false);
  const scrollTimeout = useRef<any>(null);
  const initialScrollDone = useRef(false);
  const emptyPuzzles = useMemo(() => [], []);

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
  const { ref, inView } = useInView({ root: filmstripNode, rootMargin: '400px 0px', triggerOnce: true });
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

  useLayoutEffect(() => {
    if (scrollRestoreRef.current && mainViewRef.current) {
        const { page, ratio } = scrollRestoreRef.current;
        const newPageEl = pageWrapperRefs.current.get(page);
        if (newPageEl) {
            // Restore scroll position relative to the element that was in view.
            mainViewRef.current.scrollTop = newPageEl.offsetTop + (ratio * newPageEl.clientHeight);
        }
        scrollRestoreRef.current = null; // Reset after use
    }
  }, [zoom]); // This effect runs only when zoom changes and the DOM has updated.

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (optionsMenuRef.current && !optionsMenuRef.current.contains(event.target as Node)) {
            setIsOptionsOpen(false);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // --- PDF loading effect replaced to add caching and delayed destroy to avoid flicker ---
  useEffect(() => {
    let isCancelled = false;
    const fingerprint = fileFingerprint(pdfFile);
    const cached = pdfCache.get(fingerprint);

    // If cached doc exists, reuse it
    if (cached) {
      // cancel pending destroy if any
      if (cached.destroyTimer) {
        window.clearTimeout(cached.destroyTimer);
        cached.destroyTimer = undefined;
      }
      cached.lastUsed = Date.now();

      setPdfDoc(cached.doc);
      setNumPages(cached.doc.numPages);
      setIsDocLoading(false);
      setError(null);

      // Ensure we have a viewport for page 1 if not present
      if (!pageViewports.has(1)) {
        cached.doc.getPage(1).then(firstPage => {
          const viewport = firstPage.getViewport({ scale: 1, rotation: firstPage.rotate });
          setPageViewport({ width: viewport.width, height: viewport.height });
          setPageViewports(prev => new Map(prev).set(1, { width: viewport.width, height: viewport.height }));
          firstPage.cleanup();
        }).catch(err => console.error("cached getPage(1) failed", err));
      }
      return () => { /* noop for reuse path */ };
    }

    // Not cached: load from blob URL
    setIsDocLoading(true);
    setError(null);

    const url = URL.createObjectURL(pdfFile);
    const loadingTask = pdfjsLib.getDocument(url);

    loadingTask.promise.then(async (pdf) => {
      if (isCancelled) {
        // If cancelled, destroy defensive
        try { pdf.destroy(); } catch (e) { /* ignore */ }
        return;
      }

      // store in cache
      pdfCache.set(fingerprint, { doc: pdf, lastUsed: Date.now() });

      setPdfDoc(pdf);
      setNumPages(pdf.numPages);

      try {
        const firstPage = await pdf.getPage(1);
        const viewport = firstPage.getViewport({ scale: 1, rotation: firstPage.rotate });
        setPageViewport({ width: viewport.width, height: viewport.height });
        setPageViewports(prev => new Map(prev).set(1, { width: viewport.width, height: viewport.height }));
        firstPage.cleanup();
      } catch (err) {
        console.error("Error reading first page viewport", err);
      }

      setIsDocLoading(false);
    }).catch(error => {
      if (!isCancelled) {
        console.error("Error loading PDF:", error);
        setError("Failed to load PDF document.");
        setIsDocLoading(false);
      }
    }).finally(() => {
      URL.revokeObjectURL(url);
    });

    return () => {
      isCancelled = true;
      // Delay destroy so quick navigations back to the PDF reuse cached doc.
      const entry = pdfCache.get(fingerprint);
      if (entry && !entry.destroyTimer) {
        // schedule destroy in 5s (adjust as needed)
        entry.destroyTimer = window.setTimeout(() => {
          try {
            entry.doc.destroy();
          } catch (e) { /* ignore */ }
          pdfCache.delete(fingerprint);
        }, 5000);
      } else if (!entry) {
        // if we didn't cache (loading failed), attempt to cancel loadingTask safely
        try { (loadingTask as any)?.destroy(); } catch (e) { /* ignore */ }
      }
    };
  }, [pdfFile]);

  useEffect(() => {
    if (!pdfDoc || numPages === 0) return;

    const pagesToLoad = new Set<number>();
    for (let i = Math.max(1, currentPage - PAGE_BUFFER); i <= Math.min(numPages, currentPage + PAGE_BUFFER); i++) {
        if (!pageViewports.has(i)) {
            pagesToLoad.add(i);
        }
    }

    if (pagesToLoad.size > 0) {
        Promise.all(Array.from(pagesToLoad).map(async pageNum => {
            try {
                const page = await pdfDoc.getPage(pageNum);
                const viewport = page.getViewport({ scale: 1.0, rotation: page.rotate });
                page.cleanup();
                return { pageNum, viewport: { width: viewport.width, height: viewport.height } };
            } catch (e) {
                console.error(`Failed to get viewport for page ${pageNum}`, e);
                return null;
            }
        })).then(results => {
            setPageViewports(prev => {
                const newMap = new Map(prev);
                results.forEach(res => {
                    if (res) {
                        newMap.set(res.pageNum, res.viewport);
                    }
                });
                return newMap;
            });
        });
    }
  }, [currentPage, pdfDoc, numPages]);
  
  useLayoutEffect(() => {
    if (isDocLoading || !pageViewport || !mainViewRef.current) {
      return; // Wait until the doc is loaded and we have dimensions
    }
    
    // If a specific zoom was passed (e.g., from DB), use it. Otherwise, calculate a smart default.
    if (initialZoom && initialZoom !== 1.0) {
        setZoom(initialZoom);
    } else {
        const viewport = pageViewport;
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
  }, [isDocLoading, pageViewport, initialZoom]);
  
  const scrollToPage = useCallback((pageNumber: number, behavior: 'smooth' | 'auto' = 'smooth') => {
    isScrollingProgrammatically.current = true;
    
    setCurrentPage(pageNumber);
    setPageInput(String(pageNumber));

    const pageEl = pageWrapperRefs.current.get(pageNumber);
    const view = mainViewRef.current;
    if (pageEl && view) {
        let scrollTop = pageEl.offsetTop - 24; // Default scroll to top with padding.
        
        // If page is shorter than viewport, center it vertically.
        if (pageEl.clientHeight < view.clientHeight) {
            scrollTop = pageEl.offsetTop - ((view.clientHeight - pageEl.clientHeight) / 2);
        }

        view.scrollTo({ top: Math.max(0, scrollTop), behavior });
        
        // Sync thumbnail
        const thumbEl = thumbRefs.current.get(pageNumber);
        if (thumbEl) {
            thumbEl.scrollIntoView({ behavior, block: 'center' });
        }
    }
    
    clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => { isScrollingProgrammatically.current = false; }, behavior === 'smooth' ? 1000 : 50);
  }, []);

  useLayoutEffect(() => {
    // Only scroll once after the doc is loaded and zoom has likely been set.
    // We check initialScrollDone to ensure this only runs on the very first load sequence.
    if (!isDocLoading && pdfDoc && !initialScrollDone.current) {
        initialScrollDone.current = true;
        scrollToPage(initialPage, 'auto');
    }
  }, [isDocLoading, pdfDoc, initialPage, scrollToPage, zoom]);

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
            const thumbEl = thumbRefs.current.get(bestVisiblePage);
            if (thumbEl) {
                // Sync thumbnail view
                thumbEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, 150);
  }, [currentPage]);
  
  const handlePagePointerDown = (e: React.PointerEvent<HTMLDivElement>, pageNum: number) => {
    if (window.innerWidth <= 768) return; // Disable cropping on mobile
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
            } else if (activeResizeHandle) {
                if (activeResizeHandle.includes('n')) {
                    newBox.y += dy;
                    newBox.height -= dy;
                }
                if (activeResizeHandle.includes('s')) {
                    newBox.height += dy;
                }
                if (activeResizeHandle.includes('w')) {
                    newBox.x += dx;
                    newBox.width -= dx;
                }
                if (activeResizeHandle.includes('e')) {
                    newBox.width += dx;
                }

                // Handle negative width/height by swapping points
                if (newBox.width < 0) {
                    newBox.x += newBox.width;
                    newBox.width = Math.abs(newBox.width);
                }
                if (newBox.height < 0) {
                    newBox.y += newBox.height;
                    newBox.height = Math.abs(newBox.height);
                }
            }
            
            // Constrain box to page boundaries
            newBox.x = Math.max(0, newBox.x);
            newBox.y = Math.max(0, newBox.y);
            newBox.width = Math.min(rect.width - newBox.x, newBox.width);
            newBox.height = Math.min(rect.height - newBox.y, newBox.height);

            setCropBox(newBox);
        }
    };

    const handlePointerUp = (e: PointerEvent) => {
        if (cropBox && (cropBox.width < 10 || cropBox.height < 10)) {
            setCropBox(null); // Discard tiny boxes
        } else {
            setIsConfirming(!!cropBox);
        }
        setCropMode('idle');
        setActiveResizeHandle(null);
        justFinishedDrawing.current = true;
        setTimeout(() => justFinishedDrawing.current = false, 100);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [cropMode, isDocLoading, currentPage, activeResizeHandle, cropBox]);

  const handleResizeHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>, handle: ResizeHandle) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      
      const pageWrapper = pageWrapperRefs.current.get(currentPage);
      if (!pageWrapper) return;
      const rect = pageWrapper.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      startDragPoint.current = { x, y };
      originalCropBox.current = cropBox;
      setCropMode('resizing');
      setActiveResizeHandle(handle);
  };
  
  const handleCropBoxPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (justFinishedDrawing.current || cropMode !== 'idle') return;
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      const pageWrapper = pageWrapperRefs.current.get(currentPage);
      if (!pageWrapper) return;
      const rect = pageWrapper.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      startDragPoint.current = { x, y };
      originalCropBox.current = cropBox;
      setCropMode('moving');
  };

  const handleConfirmCrop = async () => {
      if (!cropBox || !pdfDoc) return;
      setIsConfirming(false);
      
      const startTime = performance.now();
      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale: 1.0, rotation: page.rotate });
      
      // Calculate crop dimensions relative to the unscaled PDF page
      const cropX = (cropBox.x / (viewport.width * zoom)) * viewport.width;
      const cropY = (cropBox.y / (viewport.height * zoom)) * viewport.height;
      const cropWidth = (cropBox.width / (viewport.width * zoom)) * viewport.width;
      const cropHeight = (cropBox.height / (viewport.height * zoom)) * viewport.height;

      const tempCanvas = document.createElement("canvas");
      const tempViewport = page.getViewport({ scale: 4.0, rotation: page.rotate }); // High-res for cropping
      tempCanvas.width = tempViewport.width;
      tempCanvas.height = tempViewport.height;
      const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });

      if (tempCtx) {
          tempCtx.fillStyle = '#FFFFFF';
          tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
          // FIX: Add 'canvas' property to render parameters to satisfy TypeScript compiler.
          // The type definition in this environment seems to require it, even though it's
          // redundant when canvasContext is provided.
          await page.render({ canvasContext: tempCtx, viewport: tempViewport, canvas: tempCanvas } as any).promise;

          const finalFile = await resizeAndExportImage(
            tempCanvas,
            { maxDimension: 640, type: 'image/webp', quality: 0.85, fileName: 'cropped_puzzle.webp' },
            { 
              x: cropX * 4.0, 
              y: cropY * 4.0,
              width: cropWidth * 4.0,
              height: cropHeight * 4.0,
            }
          );
          
          if(finalFile) {
              const clientProcessingTime = performance.now() - startTime;
              onCropConfirm(finalFile, { page: currentPage, totalPages: numPages }, clientProcessingTime);
              setCropBox(null);
          }
      }
      page.cleanup();
  };
  
  const handleThumbGenerated = (pageNum: number, dataUrl: string) => {
    setThumbs(prev => new Map(prev).set(pageNum, dataUrl));
    if (pageNum === 1) {
        db.updatePdfState(pdfId, currentPage, zoom, dataUrl);
    }
  };

  const handleDeepScan = useCallback(async () => {
    await startDeepScan(currentPage, (puzzles: DetectedPuzzle[]) => {
      setScannedPuzzles(prev => new Map(prev).set(currentPage, puzzles));
      setScannedPages(prev => new Set(prev).add(currentPage));
    });
  }, [startDeepScan, currentPage]);

  useEffect(() => {
    const fetchCachedPuzzles = async () => {
        const cached = await db.getPdfPuzzles(pdfId, currentPage);
        if (cached) {
            setScannedPuzzles(prev => new Map(prev).set(currentPage, cached.puzzles));
            setScannedPages(prev => new Set(prev).add(currentPage));
        }
    };
    if (!scannedPages.has(currentPage)) {
        fetchCachedPuzzles();
    }
  }, [currentPage, pdfId, scannedPages]);
  
  const minPage = Math.max(1, currentPage - PAGE_BUFFER);
  const maxPage = Math.min(numPages, currentPage + PAGE_BUFFER);
  
  const handleBack = () => {
    if (isDeepScanning) cancelDeepScan();
    onBack();
  };

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value);
  };
  
  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pageNum = parseInt(pageInput, 10);
    if (pageNum >= 1 && pageNum <= numPages) {
        scrollToPage(pageNum);
    } else {
        setPageInput(String(currentPage));
    }
  };
  
  const handleZoom = (factor: number) => {
    const newZoom = Math.max(0.1, Math.min(5, zoom * factor));
    setZoom(newZoom);
    setIsOptionsOpen(false);
  };
  
  const fitToWidth = () => {
    if (mainViewRef.current && pageViewport) {
      const pageEl = pageWrapperRefs.current.get(currentPage);
      if (pageEl && pageEl.clientHeight > 0) {
        // Save the scroll position relative to the current page element
        const ratio = (mainViewRef.current.scrollTop - pageEl.offsetTop) / pageEl.clientHeight;
        scrollRestoreRef.current = { page: currentPage, ratio };
      }
      const containerWidth = mainViewRef.current.clientWidth - 48; // -48 for padding
      setZoom(containerWidth / pageViewport.width);
      setIsOptionsOpen(false);
    }
  };

  const fitToPage = () => {
    if (mainViewRef.current && pageViewport) {
      const pageEl = pageWrapperRefs.current.get(currentPage);
      if (pageEl && pageEl.clientHeight > 0) {
        // Save the scroll position relative to the current page element
        const ratio = (mainViewRef.current.scrollTop - pageEl.offsetTop) / pageEl.clientHeight;
        scrollRestoreRef.current = { page: currentPage, ratio };
      }
      const containerWidth = mainViewRef.current.clientWidth - 48;
      const containerHeight = mainViewRef.current.clientHeight - 48;
      const scaleX = containerWidth / pageViewport.width;
      const scaleY = containerHeight / pageViewport.height;
      setZoom(Math.min(scaleX, scaleY));
      setIsOptionsOpen(false);
    }
  };

  const scanCompleted = scannedPages.has(currentPage) && (scannedPuzzles.get(currentPage)?.length ?? 0) > 0;

  return (
    <div className="pdf-viewer-container">
        <div className="pdf-toolbar">
            <div className="pdf-toolbar-left">
                <button className="btn-icon-bare" onClick={handleBack} title="Go back" aria-label="Go back">
                    <BackIcon />
                </button>
            </div>

            <div className="pdf-toolbar-center">
                 <div ref={optionsMenuRef} className={`pdf-toolbar-group ${isOptionsOpen ? 'dropdown-active' : ''}`}>
                    <button className="btn-icon" onClick={() => setIsOptionsOpen(prev => !prev)} aria-haspopup="true" aria-expanded={isOptionsOpen} title="View Options">
                        <OptionsIcon />
                    </button>
                    {isOptionsOpen && (
                        <div className="options-dropdown">
                            <button onClick={() => handleZoom(1.25)}><ZoomInIcon /> Zoom In</button>
                            <button onClick={() => handleZoom(0.8)}><ZoomOutIcon /> Zoom Out</button>
                            <button onClick={fitToWidth}><FitToWidthIcon /> Fit to Width</button>
                            <button onClick={fitToPage}><FitPageIcon /> Fit to Page</button>
                        </div>
                    )}
                </div>
                <div className="pdf-toolbar-group zoom-controls-group">
                    <button className="btn-icon" onClick={() => handleZoom(0.8)} title="Zoom Out"><ZoomOutIcon /></button>
                    <button className="btn-icon" onClick={() => handleZoom(1.25)} title="Zoom In"><ZoomInIcon /></button>
                </div>
                 <div className="pdf-toolbar-group">
                    <button className="btn-icon" onClick={() => scrollToPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1} title="Previous Page">
                        <PrevMoveIcon />
                    </button>
                    <div className="page-input-container">
                        <form onSubmit={handlePageInputSubmit} style={{ display: 'contents' }}>
                            <input type="text" value={pageInput} onChange={handlePageInputChange} onBlur={(e) => handlePageInputSubmit(e as any)} className="page-input" aria-label="Current page number" />
                        </form>
                        <span className="page-total">/ {numPages}</span>
                    </div>
                    <button className="btn-icon" onClick={() => scrollToPage(Math.min(numPages, currentPage + 1))} disabled={currentPage >= numPages} title="Next Page">
                        <NextMoveIcon />
                    </button>
                </div>
            </div>
            
            <div className="pdf-toolbar-right">
                <button
                    className={`btn btn-secondary deep-scan-btn ${scanCompleted ? 'completed-scan' : ''}`}
                    onClick={isDeepScanning ? cancelDeepScan : handleDeepScan}
                    disabled={isDocLoading || cropMode !== 'idle'}
                    title={isDeepScanning ? "Cancel Scan" : scanCompleted ? "Re-scan Page" : "Scan page for all puzzles"}
                >
                    {isDeepScanning ? <div className="spinner-small" /> : <DeepScanIcon />}
                    <span>{isDeepScanning ? 'Scanning...' : scanCompleted ? 'Re-scan' : 'Scan'}</span>
                </button>
            </div>
        </div>
        
      <div className="pdf-body">
        <div className="pdf-filmstrip" ref={setFilmstripNode}>
            <div className="pdf-filmstrip-scroller">
            {isDocLoading ? <div className="thumb-loading">Loading PDF...</div> :
                Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
                    <div key={pageNum} ref={el => { thumbRefs.current.set(pageNum, el); }}>
                        <ThumbRenderer
                            pdfDoc={pdfDoc}
                            pageNumber={pageNum}
                            currentPage={currentPage}
                            onClick={() => scrollToPage(pageNum)}
                            thumb={thumbs.get(pageNum)}
                            onThumbGenerated={handleThumbGenerated}
                        />
                    </div>
                ))
            }
            </div>
        </div>

        <div className="pdf-main-view" ref={mainViewRef} onScroll={handleScroll}>
            {isDocLoading && ( <div className="pdf-loading-overlay"><div className="spinner"></div><p>Loading document...</p></div> )}
            <div className="pdf-main-view-scroller">
                {!isDocLoading && pdfDoc && pageViewport && Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => {
                    const isVisible = pageNum >= minPage && pageNum <= maxPage;
                    const pagePuzzles = scannedPuzzles.get(pageNum) || emptyPuzzles;
                    const vp = pageViewports.get(pageNum) || pageViewport;
                    
                    return (
                        <div 
                        key={pageNum} 
                        ref={el => { pageWrapperRefs.current.set(pageNum, el) }} 
                        className="pdf-page-wrapper"
                        onPointerDown={(e) => handlePagePointerDown(e, pageNum)}
                        >
                        <PageRenderer 
                            pdfDoc={pdfDoc} 
                            pageNumber={pageNum}
                            scale={zoom}
                            isVisible={isVisible}
                            puzzles={pagePuzzles}
                            onPuzzleClick={onPreScannedPuzzleFound ? (puzzle) => onPreScannedPuzzleFound(puzzle.fen) : ()=>{}}
                            placeholderHeight={vp.height * zoom}
                            placeholderWidth={vp.width * zoom}
                        />
                        {isDeepScanning && pageNum === currentPage && (
                            <div className="pdf-page-scan-overlay">
                                <div className="spinner" />
                                <p>{scanProgress.message}</p>
                                {scanProgress.total > 0 && <progress value={scanProgress.current} max={scanProgress.total} />}
                                <button className="btn btn-secondary" onClick={cancelDeepScan}>Cancel</button>
                            </div>
                        )}
                        {cropBox && pageNum === currentPage && (
                            <div className="pdf-crop-layer">
                                <div 
                                    className="crop-box" 
                                    style={{ left: cropBox.x, top: cropBox.y, width: cropBox.width, height: cropBox.height }}
                                    onPointerDown={handleCropBoxPointerDown}
                                    onPointerUp={(e) => e.stopPropagation()} // Prevent page pointer up
                                >
                                    {(['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'] as ResizeHandle[]).map(handle => (
                                        <div 
                                            key={handle} 
                                            className={`resize-handle resize-handle-${handle}`}
                                            onPointerDown={(e) => handleResizeHandlePointerDown(e, handle)}
                                        />
                                    ))}
                                    {isConfirming && (
                                        <div className="crop-actions">
                                            <button className="btn-icon" onClick={() => { setCropBox(null); setIsConfirming(false); }} aria-label="Cancel crop"><CloseIcon /></button>
                                            <button className="btn-icon btn-confirm" onClick={handleConfirmCrop} aria-label="Confirm crop"><CheckIcon /></button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        </div>
                    );
                })}
            </div>
        </div>
      </div>
    </div>
  );
};

export default PdfView;