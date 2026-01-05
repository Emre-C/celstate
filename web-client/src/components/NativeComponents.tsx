import React from 'react';

export const NativeButton: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <button className="px-8 py-3 bg-blue-600 text-white font-semibold rounded-full shadow-lg hover:bg-blue-700 transition-colors">
        {children}
    </button>
);

export const NativeCard: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
    <div className="w-full p-6 bg-white rounded-2xl border border-gray-100 shadow-xl flex flex-col gap-2">
        <div className="w-16 h-16 bg-gray-200 rounded-full mb-2"></div>
        <h4 className="text-xl font-bold text-gray-900">{title}</h4>
        <p className="text-gray-500">{subtitle}</p>
        <div className="mt-4 flex gap-2">
            <div className="h-8 w-20 bg-gray-100 rounded-lg"></div>
            <div className="h-8 w-20 bg-gray-100 rounded-lg"></div>
        </div>
    </div>
);

export const NativeModal: React.FC<{ isOpen: boolean; onClose: () => void; children: React.ReactNode }> = ({ isOpen, onClose, children }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <div
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={onClose}
            />
            <div className="relative w-full max-w-sm bg-white rounded-[32px] p-8 shadow-2xl animate-in fade-in zoom-in duration-200">
                {children}
            </div>
        </div>
    );
};
