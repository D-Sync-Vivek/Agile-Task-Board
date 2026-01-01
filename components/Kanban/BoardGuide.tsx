import { useEffect, useState } from "react"
const BoardGuide = () => {
    const [isVisible, setIsVisible] = useState(true);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'i' && e.ctrlKey) {
                setIsVisible((prev) => !prev);
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [])

    if (!isVisible) return null;
    return (
        <>
            <div className="hidden md:block fixed bottom-4 left-4 p-4 rounded-lg bg-gray-800 opacity-80 hover:opacity-100 transition-opacity text-white text-sm w-64 pointer-events-none select-none z-50">
                <h3 className="font-bold mb-2 text-gray-300">How to use:</h3>
                <ul className="list-disc pl-4 space-y-1">
                    <li>
                        <span className="font-semibold text-rose-400">Add Column:</span> Button on center
                    </li>
                    <li>
                        <span className="font-semibold text-rose-400">Edit Title/Task:</span> Double-click
                    </li>

                    <li>
                        <span className="font-semibold text-rose-400">Save:</span> Press <kbd className="bg-gray-700 px-1 rounded">Enter</kbd> or Click away
                    </li>
                    <li>
                        <span className="font-semibold text-rose-400">Delete:</span> Hover & click trash icon
                    </li>
                </ul>
            </div>
        </>
    )
}

export default BoardGuide