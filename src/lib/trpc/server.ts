import { auth } from "../auth";
import { db } from "../db";
import { appRouter } from "./routers";

export const createContext = async () => {
  const session = await auth.api.getSession({
    headers: new Headers(),
  });

  return {
    session,
    db,
    headers: null, // Server-side caller doesn't have headers
  };
};

export const caller = appRouter.createCaller(await createContext());
