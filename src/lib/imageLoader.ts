/**
 * Sequential image loading utility
 * Tries loading from multiple URLs and returns once one successfully loads
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
 * Attempts to load an image from the provided URLs sequentially
 * Stops at the first successful response
 */
export async function loadImageWithRace(
    options: ImageLoadOptions
): Promise<ImageLoadResult> {
    const { urls, timeout = 5000 } = options;

    if (urls.length === 0) {
        throw new Error('No URLs provided');
    }

    for (let index = 0; index < urls.length; index++) {
        const url = urls[index];
        try {
            await loadImageWithTimeout(url, timeout);
            return { url, success: true, index };
        } catch (err) {
            // Continue to next URL
        }
    }

    return { url: urls[0], success: false, index: 0 };
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
