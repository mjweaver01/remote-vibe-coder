import type { ReactNode } from "react";
import { GithubLink } from "./GithubLink.tsx";
import { NotificationsToggle } from "./NotificationsToggle.tsx";
import { PairDeviceButton } from "./PairDevice.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

interface Props {
  before?: ReactNode;
  after?: ReactNode;
}

export function HeaderActions({ before, after }: Props) {
  return (
    <>
      {before}
      <NotificationsToggle />
      <ThemeToggle />
      <GithubLink />
      <PairDeviceButton />
      {after}
    </>
  );
}
