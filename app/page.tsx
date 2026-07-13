import { headers } from "next/headers";
import { MuseApp } from "./components/MuseApp";
import { getChatGPTUser } from "./chatgpt-auth";
import {
  localDevelopmentOwner,
  ownerBindingForOwner,
} from "./lib/request-owner";

export default async function Home() {
  const user = await getChatGPTUser();
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  let localOwner: string | null = null;
  if (host) {
    try {
      localOwner = localDevelopmentOwner(new URL(`http://${host}`).hostname);
    } catch {
      // A malformed host is never trusted as the local-development owner.
    }
  }
  const pageOwner = user?.email ?? localOwner;
  const expectedOwner = pageOwner
    ? await ownerBindingForOwner(pageOwner)
    : undefined;
  return (
    <MuseApp
      key={user?.email ?? "device"}
      storageOwner={user?.email}
      expectedOwner={expectedOwner}
    />
  );
}
