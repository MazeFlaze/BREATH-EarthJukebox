## Description
Provide a concise explanation of what this pull request changes and why.

Closes #<issue_number>

## Type of Change
- [ ] `feat`: New feature or data ingestion
- [ ] `fix`: Bug fix
- [ ] `refactor`: Code reorganization with no functional change
- [ ] `test`: Adding or updating test cases
- [ ] `docs`: Documentation update

## Verification Checklist
- [ ] **Backend Tests:** Ran `pytest` in `backend/` with zero failures.
- [ ] **Frontend Check:** Ran `npm run lint` and `npx tsc --noEmit` in `frontend/`.
- [ ] **Scientific Integrity:** Confirmed Aerosol Optical Depth (AOD) is dimensionless and distinct from AQI/PM2.5.
- [ ] **No Secrets:** Verified no credentials or keys are committed.
