'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Dither from '@/components/Dither';
import { zcashRPC } from '@/services/zcash';

export default function ZmapsPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedCell, setSelectedCell] = useState<{
    x: number;
    y: number;
    mapNumber: number;
    blockStart: number;
    blockEnd: number;
    isInscribed: boolean;
  } | null>(null);
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);
  const [blockCount, setBlockCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);
  const BLOCKS_PER_MAP = 100; // Each ZMAP square represents 100 Zcash blocks
  const ZMAP_PRICE = 0.0015; // 0.0015 ZEC per ZMAP
  const ZORE_PER_MAP = 10000; // 10,000 ZORE per ZMAP
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
    let scale = 1;
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

      ctx.restore();
    }

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

    // --- Zoom Function ---
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

        setSelectedCell({
          x: gridCol,
          y: gridRow,
          mapNumber,
          blockStart,
          blockEnd,
          isInscribed,
        });
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
      canvas.style.cursor = 'grab';

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
      canvas.style.cursor = 'grab';
    };

    const handleMouseMove = (e: MouseEvent) => {
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

    // Zoom button handlers
    const handleZoomIn = () => {
      if (!canvas) return;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      zoomAt(centerX, centerY, scale * buttonZoomFactor);
    };

    const handleZoomOut = () => {
      if (!canvas) return;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      zoomAt(centerX, centerY, scale / buttonZoomFactor);
    };

    const handleReset = () => {
      scale = 1;
      resizeCanvas();
      requestAnimationFrame(draw);
    };

    // Attach zoom button listeners
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    const resetBtn = document.getElementById('reset-btn');

    zoomInBtn?.addEventListener('click', handleZoomIn);
    zoomOutBtn?.addEventListener('click', handleZoomOut);
    resetBtn?.addEventListener('click', handleReset);

    window.addEventListener('resize', handleResize);
    canvas.addEventListener('wheel', handleWheel);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });

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
    };
  }, [blockCount, loading]);

  return (
    <main className="relative w-full h-screen overflow-hidden pt-20">
      {/* Dither Background */}
      <div className="fixed inset-0 w-full h-full opacity-20 -z-10">
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
      <header className="fixed top-0 left-0 w-full flex items-center justify-between px-6 py-4 backdrop-blur-xl bg-black/30 z-20 border-b border-gold-700/30">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-2xl text-gold-400">
            ZATOSHI.MARKET
          </Link>
          <span className="text-2xl text-gold-400">ZMAPS</span>
          <span className="text-lg text-gold-300/60">
            / {blockCount > 0 ? `${blockCount.toLocaleString()} Blocks` : 'Loading...'}
          </span>
        </div>
        <Link href="/token/zore" className="px-6 py-2 text-gold-400">
          ZORE TOKEN
        </Link>
      </header>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 cursor-grab active:cursor-grabbing"
        style={{ imageRendering: 'crisp-edges' }}
      />

      {/* Manual Controls */}
      <div className="fixed bottom-4 right-4 z-20 flex flex-col space-y-2">
        <button
          id="zoom-in-btn"
          title="Zoom In"
          className="size-12 backdrop-blur-xl bg-black/30 border border-gold-700 text-gold-400 flex items-center justify-center"
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
          className="size-12 backdrop-blur-xl bg-black/30 border border-gold-700 text-gold-400 flex items-center justify-center"
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
          className="size-12 backdrop-blur-xl bg-black/30 border border-gold-700 text-gold-400 flex items-center justify-center"
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

      {/* High-End Liquid Glass Modal */}
      {selectedCell && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
          onClick={() => setSelectedCell(null)}
        >
          <div
            className="bg-gradient-to-br from-gold-900/20 via-black/40 to-gold-900/20 rounded-2xl shadow-[0_8px_32px_0_rgba(255,200,55,0.2)] w-full max-w-2xl relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Ambient glow effect */}
            <div className="absolute inset-0 bg-liquid-glass opacity-30"></div>
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold-400 to-transparent opacity-50"></div>

            {/* Content */}
            <div className="relative p-8">
              {/* Close button */}
              <button
                onClick={() => setSelectedCell(null)}
                className="absolute top-6 right-6 text-gold-400/60 hover:text-gold-300 text-2xl transition-colors"
              >
                ✕
              </button>

              {/* ZMAP Number Badge */}
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-gold-500/10 mb-6">
                <span className="text-gold-400 text-sm tracking-wider">ZMAP</span>
                <span className="text-gold-300 text-lg font-bold">
                  #{selectedCell.mapNumber.toLocaleString()}
                </span>
              </div>

              {/* Status Badge */}
              <div className="mb-8">
                <div
                  className={`inline-flex items-center gap-2 px-4 py-2 ${
                    selectedCell.isInscribed
                      ? 'bg-gold-500/20 text-gold-400'
                      : 'bg-emerald-500/20 text-emerald-400'
                  }`}
                >
                  <div
                    className={`size-2 ${
                      selectedCell.isInscribed ? 'bg-gold-400' : 'bg-emerald-400'
                    }`}
                  ></div>
                  <span className="text-sm font-medium tracking-wide">
                    {selectedCell.isInscribed ? 'INSCRIBED' : 'AVAILABLE'}
                  </span>
                </div>
              </div>

              {/* Block Info Grid */}
              <div className="grid grid-cols-2 gap-6 mb-8">
                <div className="space-y-2">
                  <div className="text-gold-400/60 text-sm tracking-wider">ZCASH BLOCKS</div>
                  <div className="text-2xl text-gold-300 font-bold tracking-tight">
                    {selectedCell.blockStart.toLocaleString()} - {selectedCell.blockEnd.toLocaleString()}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-gold-400/60 text-sm tracking-wider">ZORE QUANTITY</div>
                  <div className="text-2xl text-gold-300 font-bold tracking-tight">
                    {ZORE_PER_MAP.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Description */}
              <div className="mb-8 p-6 bg-black/30">
                <p className="text-gold-200/80 text-base leading-relaxed">
                  {selectedCell.isInscribed
                    ? 'This ZMAP has already been inscribed on the Zcash blockchain. View inscription details or transfer ownership.'
                    : `Inscribe this ZMAP to claim ownership over the land parcel, enabling you to mine the ZORE available on the land. Each ZMAP represents ${BLOCKS_PER_MAP} Zcash blocks.`}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-4">
                {selectedCell.isInscribed ? (
                  <>
                    <button className="flex-1 px-6 py-4 bg-gold-500/10 text-gold-400 font-medium tracking-wide">
                      VIEW DETAILS
                    </button>
                    <button className="flex-1 px-6 py-4 bg-gold-500 text-black font-bold tracking-wide">
                      TRANSFER
                    </button>
                  </>
                ) : (
                  <button className="w-full px-6 py-4 bg-gold-500 text-black font-bold text-lg tracking-wide">
                    Inscribe ZMAP for {ZMAP_PRICE} ZEC
                  </button>
                )}
              </div>

              {/* Footer Link */}
              <div className="mt-6 text-center">
                <Link href="/token/zore" className="text-gold-400/60 text-sm inline-flex items-center gap-2">
                  Learn more about ZMAP
                  <span className="text-xs">→</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
