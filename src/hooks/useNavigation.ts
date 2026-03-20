import {useCallback} from 'react';
import {useSandpack} from './useSandpack';

export function useNavigation(_clientId?: string): {
  refresh: () => void;
} {
  const {dispatch} = useSandpack();

  const refresh = useCallback(() => {
    dispatch({type: 'refresh'});
  }, [dispatch]);

  return {refresh};
}
