import { Injectable } from "@nestjs/common";
import { Product } from "@prisma/client";
import { CreateProductInput, ListProductsQuery, UpdateProductInput } from "@erp/validation";
import { AuditLogService } from "../common/audit/audit-log.service";
import { RequestMetadata } from "../auth/auth.service";
import { ProductsRepository, ProductListResult } from "./products.repository";

@Injectable()
export class ProductsService {
  constructor(
    private readonly productsRepository: ProductsRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  list(enterpriseId: string, query: ListProductsQuery): Promise<ProductListResult> {
    return this.productsRepository.findMany(enterpriseId, query);
  }

  get(enterpriseId: string, id: string): Promise<Product> {
    return this.productsRepository.findByIdOrThrow(enterpriseId, id);
  }

  async create(
    enterpriseId: string,
    userId: string,
    input: CreateProductInput,
    meta: RequestMetadata,
  ): Promise<Product> {
    const product = await this.productsRepository.create(enterpriseId, input);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "CREATE_PRODUCT",
      resource: "Product",
      resourceId: product.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return product;
  }

  async update(
    enterpriseId: string,
    userId: string,
    id: string,
    input: UpdateProductInput,
    meta: RequestMetadata,
  ): Promise<Product> {
    const product = await this.productsRepository.update(enterpriseId, id, input);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "UPDATE_PRODUCT",
      resource: "Product",
      resourceId: product.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return product;
  }

  async deactivate(enterpriseId: string, userId: string, id: string, meta: RequestMetadata): Promise<Product> {
    const product = await this.productsRepository.deactivate(enterpriseId, id);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "DELETE_PRODUCT",
      resource: "Product",
      resourceId: product.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return product;
  }
}
