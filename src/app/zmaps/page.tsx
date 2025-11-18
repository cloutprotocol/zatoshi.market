'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { zcashRPC } from '@/services/zcash';

// Client-only Dither to avoid SSR/hydration mismatch
const Dither = dynamic(() => import('@/components/Dither'), { ssr: false, loading: () => null });

type ZMapCell = {
  x: number;
  y: number;
  mapNumber: number;
  blockStart: number;
  blockEnd: number;
  isInscribed: boolean;
};

export default function ZmapsPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cartItems, setCartItems] = useState<ZMapCell[]>([]);
  const cartItemsRef = useRef<ZMapCell[]>([]); // Ref to access current cart items in draw function
  const drawFnRef = useRef<(() => void) | null>(null); // Ref to draw function
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);
  const [blockCount, setBlockCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [introStep, setIntroStep] = useState(1);
  const [showInfoButton, setShowInfoButton] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const zoomToCell = useRef<((x: number, y: number) => void) | null>(null);

  // Keep ref in sync with state and trigger redraw
  useEffect(() => {
    cartItemsRef.current = cartItems;
    // Trigger redraw when cart items change
    if (drawFnRef.current) {
      drawFnRef.current();
    }
  }, [cartItems]);

  useEffect(() => {
    setMounted(true);
    // Check if user has seen intro before
    const hasSeenIntro = localStorage.getItem('zmaps_intro_seen');
    if (hasSeenIntro) {
      setShowIntro(false);
      setShowInfoButton(true);
    }
  }, []);
  const BLOCKS_PER_MAP = 100; // Each ZMAP square represents 100 Zcash blocks
  const ZMAP_PRICE = 0.002; // 0.002 ZEC per ZMAP
  const COLS = 100; // Grid columns

  // Fetch real Zcash block count
  useEffect(() => {
    async function fetchBlockCount() {
      try {
        const count = await zcashRPC.getBlockCount();
        setBlockCount(count);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch block count:', error);
        setLoading(false);
      }
    }
    fetchBlockCount();
    // Refresh every 2 minutes
    const interval = setInterval(fetchBlockCount, 120000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || loading || blockCount === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // --- Grid Configuration (Dynamic based on block count) ---
    const numCols = 100;
    // Each cell represents 100 blocks, so total cells = blockCount / 100
    const totalMaps = Math.ceil(blockCount / BLOCKS_PER_MAP);
    // Add 100 more cells for loading next batch
    const numRows = Math.ceil((totalMaps + 100) / numCols);
    const cellSize = 30;
    const gridColor = '#7c6c3c'; // gold-700 darkened for grid lines
    const goldColor = '#ffc837'; // gold-500
    const mintedColor = '#ffc837'; // gold-500 for inscribed
    const loadingColor = '#4b5563'; // gray-600 for loading next 100
    const gridWidth = numCols * cellSize;
    const gridHeight = numRows * cellSize;

    // --- Pre-minted Gold Cubes ---
    const goldCubes: { x: number; y: number }[] = [];
    const numCubes = 150;
    const cubeCoords = new Set<string>();
    while (cubeCoords.size < numCubes) {
      const x = Math.floor(Math.random() * numCols);
      const y = Math.floor(Math.random() * numRows);
      cubeCoords.add(`${x},${y}`);
    }
    cubeCoords.forEach((coord) => {
      const [x, y] = coord.split(',').map(Number);
      goldCubes.push({ x, y });
    });

    // --- Transform State ---
    // Start zoomed out to show full grid
    let scale = 0.3;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    // --- Zoom Configuration ---
    const minScale = 0.1;
    const maxScale = 10;
    const zoomSpeed = 0.005;
    const buttonZoomFactor = 1.3;

    // --- Touch State ---
    let touchCache: Touch[] = [];
    let initialPinchDistance: number | null = null;
    let initialScale = 1;

    // Set canvas size
    function resizeCanvas() {
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      panX = canvas.width / 2 - (gridWidth * scale) / 2;
      panY = canvas.height / 2 - (gridHeight * scale) / 2;
    }

    // --- Main Draw Function ---
    function draw() {
      if (!canvas || !ctx) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      ctx.save();
      ctx.translate(panX, panY);
      ctx.scale(scale, scale);

      // Calculate visible portion
      const viewXMin = -panX / scale;
      const viewYMin = -panY / scale;
      const viewXMax = (canvas.width - panX) / scale;
      const viewYMax = (canvas.height - panY) / scale;

      const xStart = Math.max(0, Math.floor(viewXMin / cellSize) * cellSize);
      const xEnd = Math.min(gridWidth, Math.ceil(viewXMax / cellSize) * cellSize);
      const yStart = Math.max(0, Math.floor(viewYMin / cellSize) * cellSize);
      const yEnd = Math.min(gridHeight, Math.ceil(viewYMax / cellSize) * cellSize);

      const cellXStart = Math.max(0, Math.floor(viewXMin / cellSize));
      const cellXEnd = Math.min(numCols, Math.ceil(viewXMax / cellSize));
      const cellYStart = Math.max(0, Math.floor(viewYMin / cellSize));
      const cellYEnd = Math.min(numRows, Math.ceil(viewYMax / cellSize));

      // Draw grid lines
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1 / scale;

      ctx.beginPath();
      for (let x = xStart; x <= xEnd; x += cellSize) {
        ctx.moveTo(x + 0.5, yStart);
        ctx.lineTo(x + 0.5, yEnd);
      }
      for (let y = yStart; y <= yEnd; y += cellSize) {
        ctx.moveTo(xStart, y + 0.5);
        ctx.lineTo(xEnd, y + 0.5);
      }
      ctx.stroke();

      // Draw minted ZMAPs (gold cubes)
      ctx.fillStyle = mintedColor;
      for (const cube of goldCubes) {
        if (
          cube.x >= cellXStart &&
          cube.x <= cellXEnd &&
          cube.y >= cellYStart &&
          cube.y <= cellYEnd
        ) {
          ctx.fillRect(cube.x * cellSize, cube.y * cellSize, cellSize, cellSize);
        }
      }

      // Draw loading indicator for next 100 ZMAPs
      ctx.fillStyle = loadingColor;
      for (let i = 0; i < 100; i++) {
        const cellIndex = totalMaps + i;
        const cellX = cellIndex % numCols;
        const cellY = Math.floor(cellIndex / numCols);

        if (
          cellX >= cellXStart &&
          cellX <= cellXEnd &&
          cellY >= cellYStart &&
          cellY <= cellYEnd
        ) {
          ctx.fillRect(cellX * cellSize, cellY * cellSize, cellSize, cellSize);
        }
      }

      // Draw selected items in cart with border highlight
      ctx.strokeStyle = '#ffc837'; // gold-500
      ctx.lineWidth = 3 / scale;
      for (const item of cartItemsRef.current) {
        if (
          item.x >= cellXStart &&
          item.x <= cellXEnd &&
          item.y >= cellYStart &&
          item.y <= cellYEnd
        ) {
          ctx.strokeRect(item.x * cellSize, item.y * cellSize, cellSize, cellSize);
        }
      }

      ctx.restore();
    }

    // Store draw function ref for external calls
    drawFnRef.current = draw;

    // Store zoom function ref for external calls from sidebar
    zoomToCell.current = (x: number, y: number) => {
      const cellCenterWorldX = (x + 0.5) * cellSize;
      const cellCenterWorldY = (y + 0.5) * cellSize;
      smoothZoomToWorld(cellCenterWorldX, cellCenterWorldY, 2.5, 400);
    };

    // --- Draw Cursor Highlight ---
    function drawCursorHighlight(cursorX: number, cursorY: number) {
      if (!canvas || !ctx) return;

      const worldX = (cursorX - panX) / scale;
      const worldY = (cursorY - panY) / scale;

      const gridCol = Math.floor(worldX / cellSize);
      const gridRow = Math.floor(worldY / cellSize);

      if (gridCol >= 0 && gridCol < numCols && gridRow >= 0 && gridRow < numRows) {
        ctx.save();
        ctx.translate(panX, panY);
        ctx.scale(scale, scale);

        // Draw highlight square
        ctx.strokeStyle = '#ffd95b'; // gold-400
        ctx.lineWidth = 2 / scale;
        ctx.strokeRect(gridCol * cellSize, gridRow * cellSize, cellSize, cellSize);

        ctx.restore();
      }
    }

    // --- Smooth Zoom to World Coordinates ---
    function smoothZoomToWorld(worldX: number, worldY: number, targetScale: number, duration = 400) {
      if (!canvas) return;

      targetScale = Math.max(minScale, Math.min(maxScale, targetScale));

      const startScale = scale;
      const startPanX = panX;
      const startPanY = panY;
      const startTime = performance.now();

      // Calculate target pan to center the world coordinates on screen
      const targetPanX = canvas.width / 2 - worldX * targetScale;
      const targetPanY = canvas.height / 2 - worldY * targetScale;

      function animate(currentTime: number) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease out cubic for smooth deceleration
        const eased = 1 - Math.pow(1 - progress, 3);

        scale = startScale + (targetScale - startScale) * eased;
        panX = startPanX + (targetPanX - startPanX) * eased;
        panY = startPanY + (targetPanY - startPanY) * eased;

        requestAnimationFrame(draw);

        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      }

      requestAnimationFrame(animate);
    }

    // --- Zoom Function (instant) ---
    function zoomAt(mouseX: number, mouseY: number, newScale: number) {
      newScale = Math.max(minScale, Math.min(maxScale, newScale));

      const worldX = (mouseX - panX) / scale;
      const worldY = (mouseY - panY) / scale;

      scale = newScale;

      panX = mouseX - worldX * scale;
      panY = mouseY - worldY * scale;

      requestAnimationFrame(draw);
    }

    // --- Click Handler ---
    function handleCanvasClick(clickX: number, clickY: number) {
      const worldX = (clickX - panX) / scale;
      const worldY = (clickY - panY) / scale;

      const gridCol = Math.floor(worldX / cellSize);
      const gridRow = Math.floor(worldY / cellSize);

      // Check if click is within grid bounds
      if (gridCol >= 0 && gridCol < numCols && gridRow >= 0 && gridRow < numRows) {
        // Calculate ZMAP number (each cell = 1 ZMAP = 100 blocks)
        const mapNumber = gridRow * numCols + gridCol;

        // Calculate block range this ZMAP represents
        const blockStart = mapNumber * BLOCKS_PER_MAP + 1;
        const blockEnd = (mapNumber + 1) * BLOCKS_PER_MAP;

        // Check if this ZMAP is inscribed (has a gold cube)
        const isInscribed = goldCubes.some((cube) => cube.x === gridCol && cube.y === gridRow);

        // Don't allow adding inscribed maps to cart
        if (isInscribed) return;

        const cellData: ZMapCell = {
          x: gridCol,
          y: gridRow,
          mapNumber,
          blockStart,
          blockEnd,
          isInscribed,
        };

        // Check if item is already in cart
        const existingIndex = cartItemsRef.current.findIndex(
          (item) => item.x === gridCol && item.y === gridRow
        );

        if (existingIndex >= 0) {
          // Remove from cart
          setCartItems((prev) => prev.filter((_, i) => i !== existingIndex));
        } else {
          // Add to cart
          setCartItems((prev) => [...prev, cellData]);

          // Zoom into this cell - do this AFTER state update to avoid conflicts
          if (canvas) {
            // Calculate the center of the clicked cell in world coordinates
            const cellCenterWorldX = (gridCol + 0.5) * cellSize;
            const cellCenterWorldY = (gridRow + 0.5) * cellSize;

            // Zoom in to show the cell nicely (scale 2.5 shows good detail)
            const targetScale = 2.5;

            // Use smooth zoom animation to center on this cell
            smoothZoomToWorld(cellCenterWorldX, cellCenterWorldY, targetScale, 400);
          }
        }
      }
    }

    // --- Event Listeners ---
    const handleResize = () => {
      resizeCanvas();
      draw();
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * zoomSpeed;
      const newScale = scale * (1 + delta);
      zoomAt(e.clientX, e.clientY, newScale);
    };

    let clickStartX = 0;
    let clickStartY = 0;
    const CLICK_THRESHOLD = 10; // pixels - must be within this distance to count as click

    const handleMouseDown = (e: MouseEvent) => {
      if (!canvas) return;
      isPanning = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      clickStartX = e.clientX;
      clickStartY = e.clientY;
      canvas.style.cursor = 'grabbing';
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!canvas) return;
      isPanning = false;

      // Update cursor based on current position
      const worldX = (e.clientX - panX) / scale;
      const worldY = (e.clientY - panY) / scale;
      const gridCol = Math.floor(worldX / cellSize);
      const gridRow = Math.floor(worldY / cellSize);

      const isOverGrid = gridCol >= 0 && gridCol < numCols && gridRow >= 0 && gridRow < numRows;
      const isInscribed = goldCubes.some((cube) => cube.x === gridCol && cube.y === gridRow);

      canvas.style.cursor = (isOverGrid && !isInscribed) ? 'pointer' : 'grab';

      // Only trigger click if mouse didn't move much (not a drag)
      const dx = e.clientX - clickStartX;
      const dy = e.clientY - clickStartY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < CLICK_THRESHOLD) {
        handleCanvasClick(e.clientX, e.clientY);
      }
    };

    const handleMouseLeave = () => {
      if (!canvas) return;
      isPanning = false;
      canvas.style.cursor = 'default';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!canvas) return;

      const redraw = () => {
        draw();
        drawCursorHighlight(e.clientX, e.clientY);
      };

      if (isPanning) {
        const dx = e.clientX - lastMouseX;
        const dy = e.clientY - lastMouseY;

        panX += dx;
        panY += dy;

        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        requestAnimationFrame(redraw);
      } else {
        // Update cursor based on hover state
        const worldX = (e.clientX - panX) / scale;
        const worldY = (e.clientY - panY) / scale;
        const gridCol = Math.floor(worldX / cellSize);
        const gridRow = Math.floor(worldY / cellSize);

        // Check if hovering over a valid, available cell
        const isOverGrid = gridCol >= 0 && gridCol < numCols && gridRow >= 0 && gridRow < numRows;
        const isInscribed = goldCubes.some((cube) => cube.x === gridCol && cube.y === gridRow);

        if (isOverGrid && !isInscribed) {
          canvas.style.cursor = 'pointer';
        } else {
          canvas.style.cursor = 'grab';
        }

        requestAnimationFrame(redraw);
      }
    };

    // Touch helpers
    function getPinchDistance(touches: Touch[]) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function getPinchCenter(touches: Touch[]) {
      return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2,
      };
    }

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        touchCache.push(e.changedTouches[i]);
      }

      if (touchCache.length === 1) {
        isPanning = true;
        lastMouseX = touchCache[0].clientX;
        lastMouseY = touchCache[0].clientY;
        touchStartX = touchCache[0].clientX;
        touchStartY = touchCache[0].clientY;
      } else if (touchCache.length === 2) {
        isPanning = false;
        initialPinchDistance = getPinchDistance(touchCache);
        initialScale = scale;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();

      for (let i = 0; i < e.changedTouches.length; i++) {
        const changedTouch = e.changedTouches[i];
        const index = touchCache.findIndex((t) => t.identifier === changedTouch.identifier);
        if (index !== -1) {
          touchCache[index] = changedTouch;
        }
      }

      if (touchCache.length === 1 && isPanning) {
        const touch = touchCache[0];
        const dx = touch.clientX - lastMouseX;
        const dy = touch.clientY - lastMouseY;
        panX += dx;
        panY += dy;
        lastMouseX = touch.clientX;
        lastMouseY = touch.clientY;
        requestAnimationFrame(draw);
      } else if (touchCache.length === 2 && initialPinchDistance) {
        const newPinchDistance = getPinchDistance(touchCache);
        const newScale = initialScale * (newPinchDistance / initialPinchDistance);

        const pinchCenter = getPinchCenter(touchCache);
        zoomAt(pinchCenter.x, pinchCenter.y, newScale);
      }
    };

    let touchStartX = 0;
    let touchStartY = 0;

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();

      if (e.changedTouches.length === 1 && touchCache.length === 1) {
        const touch = e.changedTouches[0];
        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Only trigger click if touch didn't move much (not a drag/pan)
        if (distance < CLICK_THRESHOLD * 1.5) {
          handleCanvasClick(touch.clientX, touch.clientY);
        }
      }

      touchCache = touchCache.filter((t) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (t.identifier === e.changedTouches[i].identifier) return false;
        }
        return true;
      });

      if (touchCache.length < 2) {
        initialPinchDistance = null;
      }
      if (touchCache.length < 1) {
        isPanning = false;
      } else if (touchCache.length === 1) {
        isPanning = true;
        lastMouseX = touchCache[0].clientX;
        lastMouseY = touchCache[0].clientY;
      }
    };

    // Zoom button handlers with smooth animation
    const handleZoomIn = () => {
      if (!canvas) return;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      // Get current world center
      const worldCenterX = (centerX - panX) / scale;
      const worldCenterY = (centerY - panY) / scale;

      smoothZoomToWorld(worldCenterX, worldCenterY, scale * buttonZoomFactor, 250);
    };

    const handleZoomOut = () => {
      if (!canvas) return;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      // Get current world center
      const worldCenterX = (centerX - panX) / scale;
      const worldCenterY = (centerY - panY) / scale;

      smoothZoomToWorld(worldCenterX, worldCenterY, scale / buttonZoomFactor, 250);
    };

    const handleReset = () => {
      if (!canvas) return;
      const centerWorldX = gridWidth / 2;
      const centerWorldY = gridHeight / 2;
      smoothZoomToWorld(centerWorldX, centerWorldY, 0.3, 400);
    };

    const handleFitToScreen = () => {
      if (!canvas) return;
      // Calculate scale to fit entire grid on screen
      const scaleX = canvas.width / gridWidth;
      const scaleY = canvas.height / gridHeight;
      const newScale = Math.min(scaleX, scaleY) * 0.9; // 90% to add some padding

      const centerWorldX = gridWidth / 2;
      const centerWorldY = gridHeight / 2;

      smoothZoomToWorld(centerWorldX, centerWorldY, Math.max(minScale, Math.min(maxScale, newScale)), 400);
    };

    // Attach zoom button listeners
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    const resetBtn = document.getElementById('reset-btn');
    const fitBtn = document.getElementById('fit-btn');

    zoomInBtn?.addEventListener('click', handleZoomIn);
    zoomOutBtn?.addEventListener('click', handleZoomOut);
    resetBtn?.addEventListener('click', handleReset);
    fitBtn?.addEventListener('click', handleFitToScreen);

    // Fit to screen on initial load
    setTimeout(handleFitToScreen, 100);

    window.addEventListener('resize', handleResize);
    canvas.addEventListener('wheel', handleWheel);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });

    // Set initial cursor
    canvas.style.cursor = 'grab';

    resizeCanvas();
    requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
      zoomInBtn?.removeEventListener('click', handleZoomIn);
      zoomOutBtn?.removeEventListener('click', handleZoomOut);
      resetBtn?.removeEventListener('click', handleReset);
      fitBtn?.removeEventListener('click', handleFitToScreen);
    };
  }, [blockCount, loading]); // Removed cartItems - canvas doesn't need to reinitialize when cart changes

  const handleCompleteIntro = () => {
    localStorage.setItem('zmaps_intro_seen', 'true');
    setShowIntro(false);
    setShowInfoButton(true);
  };

  const handleShowIntro = () => {
    setIntroStep(1);
    setShowIntro(true);
  };

  return (
    <main className="relative w-full h-screen overflow-hidden">
      {/* Dither Background */}
      <div className="fixed inset-0 w-full h-full opacity-10 -z-10">
        {mounted && (
          <Dither
            waveColor={[0.8, 0.6, 0.2]}
            disableAnimation={false}
            enableMouseInteraction={false}
            mouseRadius={0.3}
            colorNum={4}
            waveAmplitude={0.3}
            waveFrequency={3}
            waveSpeed={0.05}
          />
        )}
      </div>

      {/* Header */}
      <header className="fixed top-0 left-0 w-full flex items-center justify-between px-6 py-4 backdrop-blur-xl bg-black/30 z-20 border-b border-gold-500/20">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-2xl text-gold-400">
            zatoshi.market
          </Link>
          <span className="text-2xl text-gold-400">ZMAPS</span>
        </div>
        <Link href="/token/zore" className="px-6 py-2 text-gold-400">
          ZORE TOKEN
        </Link>
      </header>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0"
        style={{
          imageRendering: 'crisp-edges',
          touchAction: 'none' // Prevent default touch behaviors for smooth panning
        }}
      />

      {/* Manual Controls */}
      <div className="fixed bottom-4 right-4 z-20 flex flex-col space-y-2">
        {showInfoButton && (
          <button
            onClick={handleShowIntro}
            title="Show Help"
            className="size-12 backdrop-blur-xl bg-black/30 border border-gold-500/30 text-gold-400 flex items-center justify-center text-xl font-bold"
          >
            ?
          </button>
        )}
        <button
          id="fit-btn"
          title="Fit to Screen"
          className="size-12 backdrop-blur-xl bg-black/30 border border-gold-500/30 text-gold-400 flex items-center justify-center"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
          </svg>
        </button>
        <button
          id="zoom-in-btn"
          title="Zoom In"
          className="size-12 backdrop-blur-xl bg-black/30 border border-gold-500/30 text-gold-400 flex items-center justify-center"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
        <button
          id="zoom-out-btn"
          title="Zoom Out"
          className="size-12 backdrop-blur-xl bg-black/30 border border-gold-500/30 text-gold-400 flex items-center justify-center"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
        <button
          id="reset-btn"
          title="Reset View"
          className="size-12 backdrop-blur-xl bg-black/30 border border-gold-500/30 text-gold-400 flex items-center justify-center"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <circle cx="12" cy="12" r="6"></circle>
            <line x1="12" y1="2" x2="12" y2="6"></line>
            <line x1="12" y1="18" x2="12" y2="22"></line>
            <line x1="2" y1="12" x2="6" y2="12"></line>
            <line x1="18" y1="12" x2="22" y2="12"></line>
          </svg>
        </button>
      </div>

      {/* Mobile Cart Toggle Button */}
      <button
        onClick={() => setShowCart(!showCart)}
        className="fixed bottom-20 left-4 z-40 lg:hidden size-14 backdrop-blur-xl bg-gold-500 text-black flex items-center justify-center font-bold shadow-lg shadow-gold-500/50 transition-transform active:scale-95"
      >
        <div className="relative">
          🛒
          {cartItems.length > 0 && (
            <div className="absolute -top-2 -right-2 size-5 bg-black text-gold-400 text-xs flex items-center justify-center rounded-full">
              {cartItems.length}
            </div>
          )}
        </div>
      </button>

      {/* Mobile Cart Backdrop */}
      {showCart && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setShowCart(false)}
        />
      )}

      {/* Left Sidebar Cart */}
      <div className={`fixed top-16 left-0 bottom-0 w-full sm:w-96 lg:w-[400px] backdrop-blur-xl bg-black/30 border-r border-gold-500/20 z-50 lg:z-40 flex flex-col transition-transform duration-300 ${showCart ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        {/* Cart Header */}
        <div className="p-4 sm:p-6 border-b border-gold-500/20">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-xl sm:text-2xl font-bold text-gold-300">PARCELS</h3>
            <button
              onClick={() => setShowCart(false)}
              className="lg:hidden text-gold-400/60 hover:text-gold-300 text-2xl transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Zcash Stats */}
          <div className="bg-gold-500/10 p-3 rounded mb-3 space-y-1">
            <div className="flex justify-between items-center text-xs">
              <span className="text-gold-400/70">Zcash Blocks</span>
              <span className="text-gold-300 font-mono font-bold">
                {blockCount > 0 ? blockCount.toLocaleString() : 'Loading...'}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-gold-400/70">Available ZMAPS</span>
              <span className="text-gold-300 font-mono font-bold">
                {blockCount > 0 ? Math.ceil(blockCount / BLOCKS_PER_MAP).toLocaleString() : '...'}
              </span>
            </div>
            <div className="text-gold-400/60 text-xs pt-2 border-t border-gold-500/20">
              1 ZMAP = 100 Zcash Blocks
            </div>
          </div>

          <div className="flex justify-between items-center">
            <p className="text-gold-400/60 text-sm">
              {cartItems.length === 0
                ? 'Click on available squares to add to parcels'
                : `${cartItems.length} ZMAP${cartItems.length > 1 ? 's' : ''} selected`}
            </p>
            {cartItems.length > 0 && (
              <button
                onClick={() => setCartItems([])}
                className="text-gold-400/60 hover:text-red-400 text-xs font-bold transition-colors"
              >
                Clear All
              </button>
            )}
          </div>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
          {cartItems.length === 0 ? (
            <div className="text-center py-12 text-gold-400/40">
              <div className="text-4xl mb-3">□</div>
              <p>No ZMAPs selected</p>
            </div>
          ) : (
            cartItems.map((item) => (
              <div
                key={`${item.x}-${item.y}`}
                onClick={() => {
                  if (zoomToCell.current) {
                    zoomToCell.current(item.x, item.y);
                    setShowCart(false);
                  }
                }}
                className="bg-black/40 border border-gold-500/20 rounded-lg p-4 group hover:border-gold-500/40 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-gold-400 text-xs tracking-wider">ZMAP</span>
                    <span className="text-gold-300 font-bold">#{item.mapNumber.toLocaleString()}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setCartItems((prev) => prev.filter((i) => i.mapNumber !== item.mapNumber));
                    }}
                    className="text-gold-400/40 hover:text-red-400 transition-colors text-lg leading-none"
                  >
                    ✕
                  </button>
                </div>
                <div className="space-y-2 text-sm">
                  <div>
                    <div className="text-gold-400/60 text-xs">Blocks</div>
                    <div className="text-gold-300 font-mono text-xs">
                      {item.blockStart.toLocaleString()} - {item.blockEnd.toLocaleString()}
                    </div>
                  </div>
                  <div className="flex justify-end items-end">
                    <div className="text-gold-300 font-bold">{ZMAP_PRICE} ZEC</div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Cart Footer */}
        {cartItems.length > 0 && (
          <div className="p-4 sm:p-6 border-t border-gold-500/20 bg-black/60 space-y-4">
            <div className="flex justify-between items-center text-lg">
              <span className="text-gold-400">Total</span>
              <span className="text-gold-300 font-bold">{(cartItems.length * ZMAP_PRICE).toFixed(4)} ZEC</span>
            </div>
            <button
              onClick={() => {
                setShowCheckoutModal(true);
                setShowCart(false);
              }}
              className="w-full px-6 py-4 bg-gold-500 text-black font-bold text-lg tracking-wide hover:bg-gold-400 transition-colors"
            >
              INSCRIBE ({cartItems.length})
            </button>
          </div>
        )}
      </div>

      {/* Inscribe Modal */}
      {showCheckoutModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm"
          onClick={() => setShowCheckoutModal(false)}
        >
          <div
            className="bg-gradient-to-br from-gold-900/10 via-black/100 to-gold-900/10 rounded-2xl w-full max-w-2xl relative overflow-hidden max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Ambient glow effect */}
            <div className="absolute inset-0 bg-liquid-glass opacity-50"></div>
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold-400 to-transparent opacity-60"></div>

            {/* Content */}
            <div className="relative p-6 sm:p-8 flex-1 overflow-y-auto">
              {/* Close button */}
              <button
                onClick={() => setShowCheckoutModal(false)}
                className="absolute top-4 sm:top-6 right-4 sm:right-6 text-gold-400/60 hover:text-gold-300 text-2xl transition-colors"
              >
                ✕
              </button>

              <h2 className="text-2xl sm:text-3xl font-bold text-gold-300 mb-6">Review Parcels</h2>

              {/* Order Summary */}
              <div className="relative mb-6">
                <div ref={scrollContainerRef} className="space-y-3 max-h-[40vh] overflow-y-auto pr-2">
                  {cartItems.map((item, index) => (
                    <div key={item.mapNumber} className="bg-black/30 p-4 rounded-lg flex justify-between items-center">
                      <div>
                        <div className="text-gold-300 font-bold">ZMAP #{item.mapNumber.toLocaleString()}</div>
                        <div className="text-gold-400/60 text-sm font-mono">
                          Blocks {item.blockStart.toLocaleString()} - {item.blockEnd.toLocaleString()}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-gold-300 font-bold">{ZMAP_PRICE} ZEC</div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Scroll indicator arrow */}
                {cartItems.length > 3 && (
                  <button
                    onClick={() => {
                      if (scrollContainerRef.current) {
                        scrollContainerRef.current.scrollTo({
                          top: scrollContainerRef.current.scrollHeight,
                          behavior: 'smooth'
                        });
                      }
                    }}
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 text-gold-400 animate-bounce hover:text-gold-300 transition-colors cursor-pointer"
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M19 12l-7 7-7-7"/>
                    </svg>
                  </button>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => setShowCheckoutModal(false)}
                  className="flex-1 px-6 py-4 bg-gold-500/10 text-gold-400 font-bold tracking-wide border border-gold-500/30 hover:bg-gold-500/20 transition-colors"
                >
                  Continue Selecting
                </button>
                <button className="flex-1 px-6 py-4 bg-gold-500 text-black font-bold text-lg tracking-wide hover:bg-gold-400 transition-colors">
                  <div>Inscribe ({cartItems.length}) ZMAPS</div>
                  <div className="text-sm font-normal mt-1">{(cartItems.length * ZMAP_PRICE).toFixed(4)} ZEC Total</div>
                </button>
              </div>

              {/* Footer */}
              <div className="mt-6 text-center">
                <Link href="/token/zore" className="text-gold-400/60 text-sm inline-flex items-center gap-2 hover:text-gold-400 transition-colors">
                  Learn more about ZMAP & ZORE
                  <span className="text-xs">→</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Intro Explainer Overlays */}
      {showIntro && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
          <div className="bg-gradient-to-br from-gold-900/20 via-black/40 to-gold-900/20 rounded-2xl  max-w-2xl w-full p-8">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold-400 to-transparent opacity-50"></div>

            {/* Step Indicator */}
            <div className="flex justify-center gap-2 mb-6">
              {[1, 2, 3].map((step) => (
                <div
                  key={step}
                  className={`w-8 h-1 ${
                    step === introStep ? 'bg-gold-400' : 'bg-gold-700/30'
                  }`}
                />
              ))}
            </div>

            {introStep === 1 && (
              <div>
                <h2 className="text-3xl font-bold text-gold-300 mb-4">Welcome to ZMAPS</h2>
                <p className="text-gold-200/80 text-lg mb-6">
                  ZMAPS is a digital land registry on Zcash. Each square represents 100 Zcash blocks.
                  Inscribe ZMAPs and mine ZORE tokens on your land plots.
                </p>
                <div className="bg-gold-500/10 p-4 rounded mb-6">
                  <p className="text-gold-300 text-sm">
                    <strong>Gold squares</strong> = Already inscribed<br />
                    <strong>Empty squares</strong> = Available to inscribe<br />
                    <strong>Gray squares</strong> = Loading next 100<br />
                    <strong>Click squares</strong> = Add to parcels for bulk inscription
                  </p>
                </div>
              </div>
            )}

            {introStep === 2 && (
              <div>
                <h2 className="text-3xl font-bold text-gold-300 mb-4">How to Navigate</h2>
                <p className="text-gold-200/80 text-lg mb-6">
                  Use your mouse or trackpad to explore the grid:
                </p>
                <div className="space-y-3 mb-6">
                  <div className="flex items-start gap-3">
                    <span className="text-gold-400 font-bold">•</span>
                    <span className="text-gold-200/80"><strong>Drag</strong> to pan around the grid</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-gold-400 font-bold">•</span>
                    <span className="text-gold-200/80"><strong>Scroll</strong> to zoom in and out</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-gold-400 font-bold">•</span>
                    <span className="text-gold-200/80"><strong>Click</strong> squares to add them to your parcels</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-gold-400 font-bold">•</span>
                    <span className="text-gold-200/80"><strong>Use parcels</strong> on the left to review and inscribe</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-gold-400 font-bold">•</span>
                    <span className="text-gold-200/80"><strong>Use controls</strong> on the right to zoom and reset view</span>
                  </div>
                </div>
              </div>
            )}

            {introStep === 3 && (
              <div>
                <h2 className="text-3xl font-bold text-gold-300 mb-4">Start Exploring</h2>
                <p className="text-gold-200/80 text-lg mb-6">
                  You&apos;re all set! Click on available squares to add them to your parcels.
                  Each ZMAP costs 0.002 ZEC. Inscribe ZMAPs and mine ZORE tokens on your land plots.
                  You can select multiple ZMAPs and inscribe them all at once!
                </p>
                <div className="bg-gold-500/10 p-4 rounded mb-6">
                  <p className="text-gold-300 text-sm">
                    💡 <strong>Tip:</strong> Press the <strong>?</strong> button in the bottom-right corner anytime to see this guide again.
                  </p>
                </div>
              </div>
            )}

            {/* Navigation Buttons */}
            <div className="flex gap-4 justify-between">
              {introStep > 1 && (
                <button
                  onClick={() => setIntroStep(introStep - 1)}
                  className="px-6 py-3 bg-gold-500/10 text-gold-400 font-bold border border-gold-500/30"
                >
                  BACK
                </button>
              )}
              <div className="flex-1" />
              {introStep < 3 ? (
                <button
                  onClick={() => setIntroStep(introStep + 1)}
                  className="px-6 py-3 bg-gold-500 text-black font-bold"
                >
                  NEXT
                </button>
              ) : (
                <button
                  onClick={handleCompleteIntro}
                  className="px-6 py-3 bg-gold-500 text-black font-bold"
                >
                  GET STARTED
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
