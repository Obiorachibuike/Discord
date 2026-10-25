import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerlessApp } from '@aether/server/serverless';

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const app = getServerlessApp();
  return app(req, res);
}
