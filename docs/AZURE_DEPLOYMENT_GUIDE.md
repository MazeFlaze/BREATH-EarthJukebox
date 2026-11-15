# Hướng Dẫn Deploy BREATHE Lên Azure Container Apps (Tối Ưu Chi Phí $0 Khi Idle)

Tài liệu này hướng dẫn chi tiết cách triển khai toàn bộ ứng dụng **BREATHE – Earth Information Jukebox** (Next.js Frontend + FastAPI Backend + Neon Serverless PostgreSQL) lên Microsoft Azure với tiêu chí: **Tiết kiệm tối đa ngân sách ($200 credits), chỉ kích hoạt tài nguyên khi có người dùng truy cập (Scale-to-Zero), chi phí khi idle là $0.00**.

---

## 1. Kiến Trúc Triển Khai & Cơ Chế Tiết Kiệm Chi Phí

| Thành phần | Công nghệ | Nền tảng hosting | Chính sách mở rộng & Chi phí |
| :--- | :--- | :--- | :--- |
| **Frontend** | Next.js 14 Standalone (Node 20 Alpine) | Azure Container Apps (ACA) | `minReplicas = 0`, `maxReplicas = 3`<br>Khi không có request: **0 container chạy (0$ idle)**. Miễn phí 2 triệu requests/tháng. |
| **Backend** | FastAPI + Uvicorn (Python 3.12 slim) | Azure Container Apps (ACA) | `minReplicas = 0`, `maxReplicas = 2`<br>Khi không có request: **0 container chạy (0$ idle)**. Miễn phí 180,000 vCPU-s/tháng. |
| **Database** | PostgreSQL 18 (SQLAlchemy / Psycopg 3) | Neon Serverless PostgreSQL | Compute tự động ngủ sau 5 phút idle (**0$ compute**). Dung lượng < 0.5 GB nằm trọn trong Free Tier. |
| **Image Registry** | Docker Container Registry | Azure Container Registry (ACR) | Basic SKU (~$0.16/ngày, ~5$/tháng) hoặc đẩy từ GitHub Container Registry (miễn phí). |

> [!TIP]
> **Azure Container Apps Free Allocation (Mỗi tháng):**
> - 180,000 vCPU-seconds miễn phí
> - 360,000 GiB-seconds miễn phí
> - 2,000,000 HTTP requests miễn phí
> Nhờ cấu hình `minReplicas = 0`, cả Frontend và Backend sẽ thu nhỏ về 0 instance khi không ai truy cập. Bạn có thể giữ ứng dụng hoạt động hàng tháng mà chỉ tốn vài USD từ gói $200 credits của Azure.

---

## 2. Cách 1: Deploy Trực Tiếp Bằng Azure Cloud Shell (Khuyên dùng)

Bạn không cần cài đặt Docker hay Azure CLI trên máy tính cá nhân. Có thể thực hiện trực tiếp trên trình duyệt qua **Azure Cloud Shell**:

### Bước 1: Mở Azure Cloud Shell
1. Truy cập [https://shell.azure.com](https://shell.azure.com) (chọn môi trường **Bash**).
2. Clone repository hoặc tải code lên:
   ```bash
   git clone https://github.com/MazeFlaze/BREATHE-EarthJukebox.git
   cd BREATHE-EarthJukebox
   ```

### Bước 2: Thiết lập biến môi trường Neon Database
Lấy chuỗi kết nối từ file `.env.local` của bạn và export vào Cloud Shell:
```bash
export DATABASE_URL="postgresql://neondb_owner:npg_2QBWI5vgiOYN@ep-dry-sunset-bdp6dz3j-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require"
export DATABASE_URL_UNPOOLED="postgresql://neondb_owner:npg_2QBWI5vgiOYN@ep-dry-sunset-bdp6dz3j.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require"
export AZURE_LOCATION="southeastasia" # Chọn Singapore hoặc eastus
```

### Bước 3: Chạy script tự động triển khai
```bash
chmod +x scripts/deploy-azure.sh
./scripts/deploy-azure.sh
```

Script sẽ tự động:
1. Tạo Resource Group (`rg-breathe-earth-jukebox`).
2. Tạo Azure Container Registry (ACR) và build Docker images trực tiếp trên đám mây (không cần Docker ở máy local).
3. Tạo Managed Environment cho Container Apps.
4. Triển khai Backend với `minReplicas=0` và gắn chuỗi kết nối Neon.
5. Triển khai Frontend với `minReplicas=0` và cấu hình gọi Backend.
6. Cấu hình CORS giữa Frontend và Backend.
7. Xuất ra URL công khai để bạn truy cập (ví dụ: `https://breathe-frontend.jollyocean-...azurecontainerapps.io`).

---

## 3. Cách 2: Tự Động Hóa Bằng CI/CD GitHub Actions (Chuẩn AlgoViz)

Repository sử dụng workflow hợp nhất tại [`.github/workflows/breathe-ci-cd.yml`](file:///.github/workflows/breathe-ci-cd.yml):

```mermaid
flowchart TD
    A["Pull Request vào main"] --> B["CI Pipeline"]
    C["Push/Merge vào main"] --> B

    subgraph CI["1. Continuous Integration (CI)"]
        B --> B1["Backend CI: Python 3.12, NetCDF4, Pytest"]
        B --> B2["Frontend CI: Node 20, Lint, Typecheck, Next.js Standalone Build"]
    end

    B1 --> D{"Tất cả CI Pass?"}
    B2 --> D

    D -- "Nếu là PR" --> E["Báo Green trên PR, cho phép Merge"]
    D -- "Nếu Merge vào main" --> F{"Kiểm tra Azure Secrets?"}

    subgraph CD["2. Continuous Deployment (CD Production)"]
        F -- "Có đủ Secrets" --> G1["Docker Build & Push Backend/Frontend lên ACR"]
        G1 --> G2["Deploy/Update Azure Container Apps (Scale-to-Zero)"]
        G2 --> G3["Smoke Test Health Endpoint (/api/v1/health & Next.js)"]
        F -- "Chưa cấu hình Secrets" --> H["Log thông báo hướng dẫn cấu hình (Skip an toàn)"]
    end
```

### Các Secrets cần cấu hình trên GitHub (`Settings > Secrets and variables > Actions`):
- `AZURE_CREDENTIALS`: JSON Service Principal từ lệnh `az ad sp create-for-rbac`.
- `AZURE_RESOURCE_GROUP`: `rg-breathe-earth-jukebox`
- `ACR_LOGIN_SERVER`: `<your-acr>.azurecr.io` (ví dụ: `ca951f3ca84aacr.azurecr.io`)
- `ACR_USERNAME`: `<your-acr-username>`
- `ACR_PASSWORD`: `<your-acr-password>`
- `DATABASE_URL`: Chuỗi kết nối Neon PostgreSQL (Pooled).
- `DATABASE_URL_UNPOOLED`: Chuỗi kết nối Neon PostgreSQL (Unpooled).

### Cơ chế hoạt động:
1. **Khi mở Pull Request vào `main`**: Hệ thống chạy song song kiểm thử Backend (Pytest) và Frontend (Lint + TypeScript + Standalone Build). Job Deploy không chạy trên PR.
2. **Khi Pull Request được Merge vào `main`**: Sau khi toàn bộ test pass, hệ thống sẽ **tự động build Docker images, đẩy lên ACR và deploy/cập nhật Azure Container Apps**. Kết quả deployment kèm link truy cập sẽ xuất hiện trực tiếp trong GitHub Actions Job Summary.

---

## 4. Chạy Kiểm Thử Local Bằng Docker Compose (Khi Có Docker)

Nếu máy bạn hoặc máy đồng đội có Docker Desktop / Docker Engine:
```bash
# 1. Khởi động cả frontend và backend
docker compose up --build

# 2. Truy cập:
# Frontend: http://localhost:3000
# Backend API Docs: http://localhost:8000/docs
# Neon Healthcheck: http://localhost:3000/api/neon-health
```

---

## 5. Danh Mục Các File Đã Tạo / Cập Nhật

1. [`frontend/Dockerfile`](file:///home/hien/Project/Nasa/BREATHE-EarthJukebox/frontend/Dockerfile): Multi-stage build Node.js 20 Alpine với Next.js Standalone và user bảo mật `nextjs:nodejs` (UID 1001).
2. [`frontend/.dockerignore`](file:///home/hien/Project/Nasa/BREATHE-EarthJukebox/frontend/.dockerignore): Bỏ qua `node_modules`, `.next`, cache.
3. [`backend/Dockerfile`](file:///home/hien/Project/Nasa/BREATHE-EarthJukebox/backend/Dockerfile): Python 3.12-slim kèm thư viện C `libnetcdf-dev`, `libhdf5-dev`, healthcheck và user `appuser` (UID 1001).
4. [`backend/.dockerignore`](file:///home/hien/Project/Nasa/BREATHE-EarthJukebox/backend/.dockerignore): Bỏ qua `.venv`, bytecode, cache.
5. [`docker-compose.yml`](file:///home/hien/Project/Nasa/BREATHE-EarthJukebox/docker-compose.yml): Cấu hình orchestration local chuẩn production liên kết Frontend, Backend và Neon Database.
6. [`scripts/deploy-azure.sh`](file:///home/hien/Project/Nasa/BREATHE-EarthJukebox/scripts/deploy-azure.sh): Script triển khai Azure Container Apps một chạm với cơ chế Scale-to-Zero.
7. [`.github/workflows/deploy-azure.yml`](file:///home/hien/Project/Nasa/BREATHE-EarthJukebox/.github/workflows/deploy-azure.yml): Workflow CI/CD build và deploy tự động lên Azure.
