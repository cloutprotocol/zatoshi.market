'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

const Dither = dynamic(() => import('@/components/Dither'), {
  ssr: false,
});

export default function ZmapsPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedCell, setSelectedCell] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // --- Grid Configuration ---
    const numCols = 100;
    const numRows = 300;
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

      const clickedCube = goldCubes.find((cube) => cube.x === gridCol && cube.y === gridRow);

      if (clickedCube) {
        setSelectedCell({ x: clickedCube.x, y: clickedCube.y });
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
  }, []);

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
      <header className="fixed top-0 left-0 w-full flex items-center justify-start px-6 py-4 bg-black/80 backdrop-blur-md border-b border-gold-700 z-20">
        <span className="text-3xl text-gold-400 animate-glow">ZMAPS</span>
        <span className="ml-4 text-xl text-gold-300/60">/ 100x300 Grid / Demo</span>
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
          className="size-12 bg-black/70 backdrop-blur-md border-2 border-gold-700 text-gold-300 rounded-full flex items-center justify-center shadow-lg transition-all hover:bg-gold-500/20 hover:text-gold-400 hover:border-gold-500 hover:scale-105 active:scale-95 animate-glow"
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
          className="size-12 bg-black/70 backdrop-blur-md border-2 border-gold-700 text-gold-300 rounded-full flex items-center justify-center shadow-lg transition-all hover:bg-gold-500/20 hover:text-gold-400 hover:border-gold-500 hover:scale-105 active:scale-95 animate-glow"
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
          className="size-12 bg-black/70 backdrop-blur-md border-2 border-gold-700 text-gold-300 rounded-full flex items-center justify-center shadow-lg transition-all hover:bg-gold-500/20 hover:text-gold-400 hover:border-gold-500 hover:scale-105 active:scale-95 animate-glow"
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

      {/* Mint Modal */}
      {selectedCell && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setSelectedCell(null)}
        >
          <div
            className="bg-black/90 border-2 border-gold-500 rounded-lg shadow-2xl w-full max-w-md relative overflow-hidden animate-glow"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Glowing border effect */}
            <div className="absolute inset-0 border-2 border-gold-400 opacity-50 blur-sm"></div>

            {/* Header */}
            <div className="relative flex items-center justify-between p-4 border-b border-gold-700/50 bg-liquid-glass">
              <h3 className="text-3xl text-gold-400 animate-glow">Mint ZMAPS Block</h3>
              <button
                onClick={() => setSelectedCell(null)}
                className="text-gold-400 hover:text-gold-300 text-3xl transition-colors"
              >
                &times;
              </button>
            </div>

            {/* Content */}
            <div className="relative p-6">
              <p className="text-xl text-gold-200 mb-4">
                You have selected the block at coordinates:
              </p>

              {/* Coordinate Display */}
              <div className="bg-gold-900/30 border-2 border-gold-700 rounded p-4 mb-6 backdrop-blur-sm">
                <span className="text-4xl text-gold-300 block text-center tracking-wider">
                  X: {selectedCell.x}, Y: {selectedCell.y}
                </span>
              </div>

              <p className="text-lg text-gold-300/70 mb-2">
                This block is pre-minted for demo purposes.
              </p>
              <p className="text-lg text-gold-300/70 mb-6">
                In a full application, this would be a live minting page.
              </p>

              {/* Mint Button */}
              <button className="w-full bg-gold-500 text-black text-2xl py-3 px-6 rounded-md hover:bg-liquid-glass hover:text-gold-900 transition-all active:scale-95 border-2 border-gold-500 hover:border-gold-400 animate-glow">
                MINT BLOCK
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
