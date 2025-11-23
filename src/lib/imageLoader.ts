/**
 * Race-based image loading utility
 * Tries loading from multiple URLs simultaneously and returns the first successful load
 */

export interface ImageLoadOptions {
    urls: string[];
    timeout?: number; // Timeout per URL in milliseconds (default: 5000)
}

export interface ImageLoadResult {
    url: string;
    success: boolean;
    index: number;
}

/**
 * Attempts to load an image from a single URL with timeout
 */
function loadImageWithTimeout(url: string, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const timer = setTimeout(() => {
            img.src = ''; // Cancel loading
            reject(new Error(`Timeout loading ${url}`));
        }, timeout);

        img.onload = () => {
            clearTimeout(timer);
            resolve(url);
        };

        img.onerror = () => {
            clearTimeout(timer);
            reject(new Error(`Failed to load ${url}`));
        };

        img.src = url;
    });
}

/**
 * Race-loads an image from multiple URLs simultaneously
 * Returns the first URL that successfully loads
 */
export async function loadImageWithRace(
    options: ImageLoadOptions
): Promise<ImageLoadResult> {
    const { urls, timeout = 5000 } = options;

    if (urls.length === 0) {
        throw new Error('No URLs provided');
    }

    try {
        // Race all URLs against each other
        const url = await Promise.race(
            urls.map((url) => loadImageWithTimeout(url, timeout))
        );

        const index = urls.indexOf(url);
        return { url, success: true, index };
    } catch (error) {
        // All URLs failed - try one more time with first URL
        // console.warn('All image URLs failed to load', { urls, error });
        return { url: urls[0], success: false, index: 0 };
    }
}

/**
 * Preloads images in the background
 * Useful for prefetching images before they're needed
 */
export function preloadImages(urls: string[]): void {
    urls.forEach((url) => {
        const img = new Image();
        img.src = url;
    });
}
