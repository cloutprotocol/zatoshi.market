import { useState, useRef, useCallback, useEffect } from 'react';

export function useInViewport<T extends HTMLElement>(rootMargin = '300px 0px 300px 0px') {
    const [inView, setInView] = useState(false);
    const observerRef = useRef<IntersectionObserver | null>(null);

    const ref = useCallback(
        (node: T | null) => {
            if (observerRef.current) {
                observerRef.current.disconnect();
                observerRef.current = null;
            }
            if (!node || inView) return;
            const observer = new IntersectionObserver(
                (entries) => {
                    entries.forEach((entry) => {
                        if (entry.isIntersecting) {
                            setInView(true);
                            observer.disconnect();
                        }
                    });
                },
                { rootMargin }
            );
            observer.observe(node);
            observerRef.current = observer;
        },
        [inView, rootMargin]
    );

    useEffect(() => () => observerRef.current?.disconnect(), []);

    return { ref, inView } as { ref: (node: T | null) => void; inView: boolean };
}
