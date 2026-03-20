import {createContext} from 'react';
import type {SandpackContext as SandpackContextType} from './types';

export const SandpackContext = createContext<SandpackContextType | null>(null);
