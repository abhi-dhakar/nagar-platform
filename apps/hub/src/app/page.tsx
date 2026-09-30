import { FoundationCard, ProductShell } from "@nagar/ui";

export default function HomePage() {
  return (
    <ProductShell
      product="NagarHub"
      index="01"
      tagline={
        <>
          Your code. <br /> Your community.
        </>
      }
      actions={
        <>
          <a className="primary-link" href="/signup">
            Create account <span>↗</span>
          </a>
          <a className="home-signin" href="/login">
            Sign in
          </a>
        </>
      }
    >
      <FoundationCard
        number="01"
        title="One identity"
        body="One Nagar identity carries through your repositories, teams, reviews, and deployment workflow."
      />
      <FoundationCard
        number="02"
        title="Built in concert"
        body="Shared packages and a versioned API give every product a consistent foundation."
      />
      <FoundationCard
        number="03"
        title="Ready to grow"
        body="Issues, reviews, permissions, organizations, notifications, and signed webhooks bring teams into the loop."
      />
    </ProductShell>
  );
}
