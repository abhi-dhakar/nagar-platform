import { FoundationCard, ProductShell } from "@nagar/ui";

export default function HomePage() {
  return (
    <ProductShell
      product="NagarCode"
      note="NAGAR PLATFORM · PLANNED"
      status="In planning · not built yet"
      index="02"
      tagline={
        <>
          Make space <br /> to make things.
        </>
      }
    >
      <FoundationCard
        number="01"
        title="One identity"
        body="One Nagar account is designed to follow your work from a hosted repository into a cloud workspace."
      />
      <FoundationCard
        number="02"
        title="Built in concert"
        body="Shared packages and a versioned API give every product a consistent foundation."
      />
      <FoundationCard
        number="03"
        title="Ready to grow"
        body="A modular architecture makes room for Git hosting, cloud development, and deployment."
      />
    </ProductShell>
  );
}
