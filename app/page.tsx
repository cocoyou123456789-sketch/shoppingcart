import { MuseApp } from "./components/MuseApp";
import { getChatGPTUser } from "./chatgpt-auth";

export default async function Home() {
  const user = await getChatGPTUser();
  return <MuseApp key={user?.email ?? "device"} storageOwner={user?.email} />;
}
