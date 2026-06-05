# Policy Coverage Details

This file intentionally summarizes the example policy used by the app. The source policy JSON is `policy_terms.json`.

## Policy

```text
Policy ID: PLUM_OPD_2024
Policy Name: Plum OPD Advantage
Company: TechCorp Solutions Pvt Ltd
Effective Date: 2024-01-01
```

## Limits

```text
Annual Limit: 50000
Per Claim Limit: 5000
Family Floater Limit: 150000
Minimum Claim Amount: 500
Submission Timeline: 30 days
```

## Covered Categories

| Category | Coverage |
| --- | --- |
| Consultation | Covered, sub-limit 2000, 10% copay, 20% network discount |
| Diagnostic Tests | Covered, sub-limit 10000 |
| Pharmacy | Covered, sub-limit 15000 |
| Dental | Covered, sub-limit 10000 |
| Vision | Covered, sub-limit 5000 |
| Alternative Medicine | Covered, sub-limit 8000 |

## Diagnostic Notes

Covered diagnostic examples:

- Blood tests
- Urine tests
- X-rays
- ECG
- Ultrasound
- MRI with pre-auth
- CT Scan with pre-auth

High-value MRI/CT claims are guarded by backend pre-auth checks.

## Dental Notes

Covered:

- Filling
- Extraction
- Root canal
- Cleaning

Not covered:

- Cosmetic dental procedures such as teeth whitening

## Alternative Medicine

Covered treatments:

- Ayurveda
- Homeopathy
- Unani

## Waiting Periods

| Type | Days |
| --- | ---: |
| Initial waiting | 30 |
| Pre-existing diseases | 365 |
| Maternity | 270 |
| Diabetes | 90 |
| Hypertension | 90 |
| Joint replacement | 730 |

## Exclusions

- Cosmetic procedures
- Weight loss treatments
- Infertility treatments
- Experimental treatments
- Self-inflicted injuries
- Adventure sports injuries
- War and nuclear risks
- HIV/AIDS treatment
- Alcoholism/drug abuse treatment
- Non-allopathic treatments except listed categories
- Vitamins and supplements unless prescribed for deficiency

## Required Documents

- Original bills and receipts
- Prescription from registered doctor
- Diagnostic test reports, if applicable
- Pharmacy bills with prescription
- Visible doctor registration number
- Patient details matching policy records

## Cashless Facilities

```text
Available: yes
Network only: yes
Pre-approval required: no
Instant approval limit: 5000
```

Network hospitals:

- Apollo Hospitals
- Fortis Healthcare
- Max Healthcare
- Manipal Hospitals
- Narayana Health
