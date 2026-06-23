import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../shared/trpc';

export const trpc = createTRPCReact<AppRouter>();
