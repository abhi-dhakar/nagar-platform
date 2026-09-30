import { FoundationCard, ProductShell } from "@nagar/ui";

export default function HomePage() {
  return (
    <ProductShell
      product="NagarDeploy"
      index="03"
      tagline={
        <>
          From commit <br /> to customer.
        </>
      }
    >
      <FoundationCard
        number="01"
        title="One identity"
        body="A shared Nagar account will connect each product and keep your work in one place."
      />
      <FoundationCard
        number="02"
        title="Built in concert"
        body="Shared packages and a versioned API give every product a consistent foundation."
      />
      <FoundationCard
        number="03"
        title="Ready to grow"
        body="Hub collaboration comes first; build queues and isolated deployments are planned next."
      />
    </ProductShell>
  );
}
