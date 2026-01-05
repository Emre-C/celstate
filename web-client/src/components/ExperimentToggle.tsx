import React from 'react';

interface ExperimentToggleProps {
    mode: 'native' | 'celstate';
    onToggle: (mode: 'native' | 'celstate') => void;
}

export const ExperimentToggle: React.FC<ExperimentToggleProps> = ({ mode, onToggle }) => {
    return (
        <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-full border border-gray-200">
            <button
                onClick={() => onToggle('native')}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${mode === 'native'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
            >
                Native CSS
            </button>
            <button
                onClick={() => onToggle('celstate')}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${mode === 'celstate'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
            >
                Celstate SDK
            </button>
        </div>
    );
};
