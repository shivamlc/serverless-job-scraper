# specs/09-terraform-infra.md (Packaging Playwright for Lambda)
#
# One shared image, two Lambda functions — each Terraform aws_lambda_function
# overrides image_config.command to point at its own handler (handlers/listJobs.handler
# or handlers/jobDetail.handler); this Dockerfile's CMD is just a default.

FROM public.ecr.aws/lambda/nodejs:20 AS builder

WORKDIR /build
COPY package.json package-lock.json* tsconfig.json tsconfig.build.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM public.ecr.aws/lambda/nodejs:20

WORKDIR ${LAMBDA_TASK_ROOT}
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=builder /build/dist ./

CMD ["handlers/listJobs.handler"]
