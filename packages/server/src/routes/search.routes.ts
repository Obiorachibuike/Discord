import { Router } from 'express';
import { searchMessagesSchema } from '@aether/shared';
import { mustAuth, requireAuth } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate.js';
import { search } from '../services/search.service.js';

export const searchRouter = Router();
searchRouter.use(requireAuth);

searchRouter.get('/messages', validateQuery(searchMessagesSchema), async (req, res) => {
  const auth = mustAuth(req);
  const query = (req as unknown as { parsedQuery: Parameters<typeof search.searchMessages>[1] }).parsedQuery;
  res.json(await search.searchMessages(auth.id, query));
});
