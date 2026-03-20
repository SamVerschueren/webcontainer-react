import {useContext} from 'react';
import {SandpackContext} from '../context';
import type {SandpackContext as SandpackContextType} from '../types';

export function useSandpack(): SandpackContextType {
  const ctx = useContext(SandpackContext);
  if (ctx === null) {
    throw new Error('useSandpack must be used within a SandpackProvider');
  }
  return ctx;
}
