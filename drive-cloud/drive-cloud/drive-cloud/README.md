# Cloud-Based File Storage and Sharing System

React + Node/Express + MongoDB, containerised with Docker, tested in a VirtualBox VM,
deployed on AWS EC2 with files stored in S3, plus a CloudSim upload-rush simulation.

```
drive-cloud/
├── docker-compose.yml
├── backend/      Express API (auth, upload/download, sharing, public links, quota)
│   └── src/storage.js   local disk OR Amazon S3 (chosen by the S3_BUCKET variable)
├── frontend/     React (Vite) UI served by Nginx
└── cloudsim/     DriveSimulation.java
```

## Features
- Sign up / log in (JWT, bcrypt passwords)
- Upload (max 25 MB per file), download, delete, 100 MB quota per user
- Share a file with another user by email, and stop sharing
- Public link that expires after 24 hours, which can be turned off
- Storage backend switches between local disk and S3 with one environment variable

## 1. Run locally with Docker
```bash
docker compose up --build
```
Open http://localhost. Create two accounts (use a private window for the second), upload a file as
the first, share it with the second one's email, and check "Shared with me". Try "Get link" and open
the link in a private window.

Handy: `docker compose logs -f backend`, `docker compose down`, `docker compose down -v` (wipes DB and files).

## 2. Run inside Oracle VirtualBox (private cloud)
1. Create an Ubuntu Server 22.04 VM (2 CPU, 4 GB RAM, 20 GB disk).
2. Network: NAT with port forwarding Host 8080 -> Guest 80 (and Host 2222 -> Guest 22 for SSH).
3. Inside the VM:
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER && newgrp docker
cd drive-cloud && docker compose up -d --build
```
4. Open http://localhost:8080 on your host. Files here live on the Docker volume `uploads`.
   Screenshot the VM, `docker ps` and the app.

## 3. Deploy on AWS with S3 storage
1. **S3** -> Create bucket (keep *Block all public access* ON). Note the name and region.
2. **IAM** -> Create policy allowing only your bucket:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
    "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
  }]
}
```
   Create an IAM **role** for EC2 with this policy. No access keys are stored anywhere.
3. **EC2** -> Launch Ubuntu 22.04 t2.micro/t3.micro, attach the role (Advanced details -> IAM instance profile).
   Security Group: SSH (22) from *My IP*, HTTP (80) from anywhere.
4. Because the API runs inside a container, raise the metadata hop limit so it can reach the role credentials:
   EC2 -> Actions -> Instance settings -> *Modify instance metadata options* -> hop limit = **2**.
5. SSH in, install Docker as above, copy the project, then:
```bash
cp .env.example .env      # set JWT_SECRET, S3_BUCKET=YOUR-BUCKET-NAME, AWS_REGION=your-region
docker compose up -d --build
curl localhost/api/health   # should show "storage":"s3"
```
6. Upload a file in the app and confirm it appears in the S3 bucket.
7. Extras for the report: CloudWatch CPU graph and alarm, S3 versioning or lifecycle rule, ALB + Auto Scaling.
   Stop or terminate the instance and empty the bucket when done to avoid charges.

## 4. CloudSim upload-rush simulation
1. Download CloudSim 3.0.3 and note the path of `cloudsim-3.0.3.jar`.
2. From the `cloudsim/` folder:
```bash
javac -cp cloudsim-3.0.3.jar DriveSimulation.java
java  -cp .:cloudsim-3.0.3.jar DriveSimulation      # Windows: use ; instead of :
```
It simulates 100/500/1000 users transferring files together (60% 1 MB, 30% 10 MB, 10% 25 MB) on
2/5/10 VMs, time-shared vs space-shared, and prints average response time, makespan and cost.
Chart it in Excel and use it to justify your EC2 size / Auto Scaling settings.

## Production notes (mention in viva)
- Files pass through the API (simple and secure). At larger scale, use S3 pre-signed URLs so uploads go straight to S3.
- Add HTTPS (ALB + ACM), virus scanning, per-file encryption (S3 SSE-KMS) and rate limiting.
- Set a strong `JWT_SECRET`; move MongoDB to a managed service.
