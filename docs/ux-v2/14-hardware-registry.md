# 14-arch. Hardware research registry + availability contract

This is **concern A** (research registry) plus the **availability contract** every hardware entry must
satisfy before it can be promoted to the supported catalog (concern B). It is a **candidate research
scope**, not an instruction to expose every item. **Roadmap/un-benchmarked hardware must not appear as
selectable or recommended AWS capacity** until its AWS configuration, topology, memory, availability and
usable performance evidence are confirmed.

Keep these **distinct** at all times: **AWS instance type · accelerator/GPU · rack/system platform ·
serving-group topology.** A rack-scale NVL72 benchmark is not automatically an EC2-instance benchmark.

---

## Availability contract (required fields per hardware entry)

Every entry must carry: **exact instance/delivery model · availability state · source URL · source
organization · verified date · applicable region(s) · purchasing/delivery mechanism.**

**Availability states:** `aws-listed · public-on-demand · capacity-blocks · private-ai-factory ·
research-only · unavailable-for-recommendation`.

> The **existence of an NVIDIA platform ≠ general EC2 availability.** Announced ≠ deliverable ≠ priced ≠
> benchmarked.

---

## Initial research registry (AWS H100 generation forward)

Verified **2026-07-14** against AWS sources. **Evidence** column reflects the *frozen rc-qa-11 registry*
(what the app can model today), independent of AWS availability.

| Accelerator | AWS instance / delivery | Platform | Availability state | Region(s) | Purchasing | Evidence (frozen) | Source |
|---|---|---|---|---|---|---|---|
| **H100** | `p5.48xlarge` (8 GPU) | EC2 instance | public-on-demand + capacity-blocks | broad (multi-region) | On-demand / RI / Savings / Spot / Capacity Blocks | **none** (no baked benchmark) | AWS EC2 P5 [ec2/instance-types/p5](https://aws.amazon.com/ec2/instance-types/p5/); GA 2023-07 [whats-new](https://aws.amazon.com/about-aws/whats-new/2023/07/amazon-ec2-p5-instances-generative-ai-hpc-generally-available/) |
| **H200** | `p5e.48xlarge` (8 GPU) | EC2 instance | capacity-blocks | US East (Ohio)+ | Capacity Blocks | **none** | AWS whats-new 2024-09 [p5e CB](https://aws.amazon.com/about-aws/whats-new/2024/09/amazon-ec2-p5e-instances-ec2-capacity-blocks/) |
| **H200** | `p5en.48xlarge` (8 GPU, EFAv3) | EC2 instance | public-on-demand + capacity-blocks | N.Virginia, Ohio, Oregon, N.California, Spain, Jakarta, Mumbai, Seoul, Tokyo | On-demand / CB | **none** | AWS whats-new 2024-12 [p5en GA](https://aws.amazon.com/about-aws/whats-new/2024/12/amazon-ec2-p5en-instances-generative-ai-hpc-generally-available/); blog [p5en](https://aws.amazon.com/blogs/aws/new-amazon-ec2-p5en-instances-with-nvidia-h200-tensor-core-gpus-and-efav3-networking/) |
| **B200** | `p6-b200.48xlarge` (8 GPU, 1440 GB) | EC2 instance | capacity-blocks (+ Savings) → on-demand regions | US West (Oregon), US East (N.Virginia, Ohio), GovCloud | Capacity Blocks / Savings / On-demand | **measured** (dsv4 FP4, glm5 FP4/FP8, minimaxm3 FP8) → **customer-supported** | AWS whats-new 2025-05 [p6-b200 GA](https://aws.amazon.com/about-aws/whats-new/2025/05/amazon-ec2-p6-b200-instances-nvidia-b200-gpus/); N.Virginia 2025-07; GovCloud 2026-05/06 |
| **B300** (Blackwell Ultra) | `p6-b300.48xlarge` (8 GPU, 2.1 TB) | EC2 instance | capacity-blocks + Savings | US West (Oregon), US East (N.Virginia), GovCloud | Capacity Blocks / Savings | **none** → registry-only | AWS whats-new 2025-11 [p6-b300 GA](https://aws.amazon.com/about-aws/whats-new/2025/11/amazon-ec2-p6-b300-instances-nvidia-blackwell-ultra-gpus-available/); US East 2026-05 |
| **GB200** (Grace Blackwell) | `P6e-GB200 UltraServer` (up to 72 GPU, NVL72) | **rack/UltraServer** — *not* an 8-GPU EC2 box | capacity-blocks | Dallas Local Zone | Capacity Blocks | **none** → registry-only | AWS News Blog [P6e-GB200 UltraServers](https://aws.amazon.com/blogs/aws/new-amazon-ec2-p6e-gb200-ultraservers-powered-by-nvidia-grace-blackwell-gpus-for-the-highest-ai-performance/) |
| **GB300** (Blackwell Ultra) | `P6e-GB300 UltraServer` (NVL72, ~20 TB/US) | **rack/UltraServer** | capacity-blocks | (verify region) | Capacity Blocks | **none** → registry-only | AWS news 2025-12 [P6e-GB300 GA](https://aws-news.com/article/2025-12-02-amazon-ec2-p6e-gb300-ultraservers-accelerated-by-nvidia-gb300-nvl72-are-now-generally-available) |
| **Vera Rubin** | *no confirmed AWS instance* | research | **research-only** | — | — | **none** | NVIDIA roadmap; **no AWS instance/topology/price — do not invent** |

*(A10G/G5 and older are deliberately excluded — a theoretically-possible config is not added merely to
demonstrate it can be rejected.)*

---

## Reading the registry

- **Only B200 (`p6-b200`) is customer-supported today**, because it is the only accelerator with baked
  benchmark evidence. Everything else is **available on AWS but not evaluated** → research-registry only.
- **B300, GB200, GB300 are GA on AWS but have no evidence in the frozen engine** → they must **not**
  appear as selectable or recommended capacity. They enter the supported catalog only after a benchmark
  + feasibility + pricing pass.
- **GB200/GB300 are UltraServers (rack-scale NVL72)**, a different delivery model from an 8-GPU EC2
  instance. Their topology must be modeled as a platform, not silently mapped onto an EC2 8-GPU box.

---

## Supported-hardware inclusion criteria (promotion A → B)

A hardware entry may enter the **customer-facing catalog** only when **all** are true:
1. **Availability** is confirmed with the full contract (state, source, date, region, mechanism).
2. **Delivery model is modeled correctly** — EC2 instance vs UltraServer/rack; GPU count; interconnect.
3. **Memory & topology** are known (per-GPU HBM, box/rack GPU count, NVLink/EFA).
4. **A truthful price state** exists ([16-evidence-pricing-contracts.md](16-evidence-pricing-contracts.md)).
5. **At least one applicable evidence path** (measured-exact or a defensible measured-scaled/extrapolated)
   exists for at least one supported model.
6. **Deterministic feasibility** can be computed and **tests** cover it.

Miss any one → **stay in the research registry**; do not fill the gap with a plausible value.

---

## Sources

- [Amazon EC2 P5 (H100)](https://aws.amazon.com/ec2/instance-types/p5/) · [P5 GA 2023-07](https://aws.amazon.com/about-aws/whats-new/2023/07/amazon-ec2-p5-instances-generative-ai-hpc-generally-available/)
- [P5e via Capacity Blocks 2024-09](https://aws.amazon.com/about-aws/whats-new/2024/09/amazon-ec2-p5e-instances-ec2-capacity-blocks/) · [P5en GA 2024-12](https://aws.amazon.com/about-aws/whats-new/2024/12/amazon-ec2-p5en-instances-generative-ai-hpc-generally-available/)
- [P6 family (P6e + P6)](https://aws.amazon.com/ec2/instance-types/p6/) · [P6-B200 GA 2025-05](https://aws.amazon.com/about-aws/whats-new/2025/05/amazon-ec2-p6-b200-instances-nvidia-b200-gpus/)
- [P6-B300 GA 2025-11](https://aws.amazon.com/about-aws/whats-new/2025/11/amazon-ec2-p6-b300-instances-nvidia-blackwell-ultra-gpus-available/) · [P6e-GB200 UltraServers](https://aws.amazon.com/blogs/aws/new-amazon-ec2-p6e-gb200-ultraservers-powered-by-nvidia-grace-blackwell-gpus-for-the-highest-ai-performance/) · [P6e-GB300 GA 2025-12](https://aws-news.com/article/2025-12-02-amazon-ec2-p6e-gb300-ultraservers-accelerated-by-nvidia-gb300-nvl72-are-now-generally-available)
- [EC2 instance types by Region](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-regions.html) (verify region availability at implementation time)
