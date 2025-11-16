'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { zcashRPC } from '@/services/zcash';

const Dither = dynamic(() => import('@/components/Dither'), {
  ssr: false,
});

export default function ZmapsPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedCell, setSelectedCell] = useState<{
    x: number;
    y: number;
    blockNumber: number;
    isInscribed: boolean;
  } | null>(null);
  const [blockCount, setBlockCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const BLOCK_PRICE = 0.10; // $0.10 per block for ZORE mining
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
    // Calculate rows based on actual block count, minimum 300 for padding
    const numRows = Math.max(300, Math.ceil(blockCount / numCols) + 50);
    const cellSize = 30;
    const gridColor = '#7c6c3c'; // gold-700 darkened for grid lines
    const goldColor = '#ffc837'; // gold-500
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

      // Draw gold cubes
      ctx.fillStyle = goldColor;
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

      ctx.restore();
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
        // Calculate block number (row * columns + column)
        const blockNumber = gridRow * numCols + gridCol;

        // Check if this block is inscribed (has a gold cube)
        const isInscribed = goldCubes.some((cube) => cube.x === gridCol && cube.y === gridRow);

        setSelectedCell({
          x: gridCol,
          y: gridRow,
          blockNumber,
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

    const handleMouseDown = (e: MouseEvent) => {
      if (!canvas) return;
      isPanning = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      canvas.style.cursor = 'grabbing';
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!canvas) return;
      isPanning = false;
      canvas.style.cursor = 'grab';

      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
        handleCanvasClick(e.clientX, e.clientY);
      }
    };

    const handleMouseLeave = () => {
      if (!canvas) return;
      isPanning = false;
      canvas.style.cursor = 'grab';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isPanning) return;
      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;

      panX += dx;
      panY += dy;

      lastMouseX = e.clientX;
      lastMouseY = e.clientY;

      requestAnimationFrame(draw);
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

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();

      if (e.changedTouches.length === 1 && touchCache.length === 1) {
        const touch = e.changedTouches[0];
        const dx = touch.clientX - lastMouseX;
        const dy = touch.clientY - lastMouseY;
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
          handleCanvasClick(lastMouseX, lastMouseY);
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
    <main className="relative w-full h-screen overflow-hidden bg-black">
      {/* Dither Background */}
      <div className="fixed inset-0 w-full h-full opacity-20">
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
      </div>

      {/* Header */}
      <header className="fixed top-0 left-0 w-full flex items-center justify-between px-6 py-4 bg-black/90 z-20">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-3xl text-gold-400 animate-glow hover:text-gold-300 transition-colors">
            ZATOSHI.MARKET
          </Link>
          <span className="text-3xl text-gold-400 animate-glow">ZMAPS</span>
          <span className="text-xl text-gold-300/60">
            / {blockCount > 0 ? `${blockCount.toLocaleString()} Blocks` : 'Loading...'}
          </span>
        </div>
        <Link
          href="/token/zore"
          className="px-6 py-2 text-gold-400 hover:text-gold-300 transition-all"
        >
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
          className="size-12 bg-black/70 text-gold-300 rounded-full flex items-center justify-center transition-all hover:bg-gold-500/20 hover:text-gold-400 hover:scale-105 active:scale-95 animate-glow"
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
          className="size-12 bg-black/70 text-gold-300 rounded-full flex items-center justify-center transition-all hover:bg-gold-500/20 hover:text-gold-400 hover:scale-105 active:scale-95 animate-glow"
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
          className="size-12 bg-black/70 text-gold-300 rounded-full flex items-center justify-center transition-all hover:bg-gold-500/20 hover:text-gold-400 hover:scale-105 active:scale-95 animate-glow"
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

              {/* Block Number Badge */}
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-gold-500/10 rounded-full mb-6">
                <span className="text-gold-400 text-sm tracking-wider">BLOCK</span>
                <span className="text-gold-300 text-lg font-bold">
                  #{selectedCell.blockNumber.toLocaleString()}
                </span>
              </div>

              {/* Status Badge */}
              <div className="mb-8">
                <div
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${
                    selectedCell.isInscribed
                      ? 'bg-gold-500/20 text-gold-400'
                      : 'bg-emerald-500/20 text-emerald-400'
                  }`}
                >
                  <div
                    className={`size-2 rounded-full ${
                      selectedCell.isInscribed ? 'bg-gold-400' : 'bg-emerald-400'
                    } animate-pulse`}
                  ></div>
                  <span className="text-sm font-medium tracking-wide">
                    {selectedCell.isInscribed ? 'INSCRIBED' : 'AVAILABLE'}
                  </span>
                </div>
              </div>

              {/* Block Info Grid */}
              <div className="grid grid-cols-2 gap-6 mb-8">
                <div className="space-y-2">
                  <div className="text-gold-400/60 text-sm tracking-wider">COORDINATES</div>
                  <div className="text-3xl text-gold-300 font-bold tracking-tight">
                    {selectedCell.x}, {selectedCell.y}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-gold-400/60 text-sm tracking-wider">ZORE MINING</div>
                  <div className="text-3xl text-gold-300 font-bold tracking-tight">
                    ${BLOCK_PRICE.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Description */}
              <div className="mb-8 p-6 bg-black/30 rounded-xl">
                <p className="text-gold-200/80 text-lg leading-relaxed">
                  {selectedCell.isInscribed
                    ? 'This block has already been inscribed on the Zcash blockchain. View inscription details or transfer ownership.'
                    : `Claim this block and mine ZORE tokens. Each block represents a unique position on the Zcash blockchain. Total supply limited to ${blockCount.toLocaleString()} blocks.`}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-4">
                {selectedCell.isInscribed ? (
                  <>
                    <button className="flex-1 px-6 py-4 bg-gold-500/10 hover:bg-gold-500/20 text-gold-400 rounded-xl transition-all font-medium tracking-wide">
                      VIEW DETAILS
                    </button>
                    <button className="flex-1 px-6 py-4 bg-gradient-to-r from-gold-500 to-gold-600 hover:from-gold-400 hover:to-gold-500 text-black rounded-xl transition-all font-bold tracking-wide shadow-[0_0_20px_rgba(255,200,55,0.3)]">
                      TRANSFER
                    </button>
                  </>
                ) : (
                  <button className="w-full px-6 py-4 bg-gradient-to-r from-gold-500 to-gold-600 hover:from-gold-400 hover:to-gold-500 text-black rounded-xl transition-all font-bold text-lg tracking-wide shadow-[0_0_30px_rgba(255,200,55,0.4)] hover:shadow-[0_0_40px_rgba(255,200,55,0.6)]">
                    MINT BLOCK FOR ${BLOCK_PRICE.toFixed(2)}
                  </button>
                )}
              </div>

              {/* Footer Link */}
              <div className="mt-6 text-center">
                <Link
                  href="/token/zore"
                  className="text-gold-400/60 hover:text-gold-300 text-sm transition-colors inline-flex items-center gap-2"
                >
                  Learn more about ZORE token
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
