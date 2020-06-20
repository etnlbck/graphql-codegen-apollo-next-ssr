import { Types } from "@graphql-codegen/plugin-helpers";
import {
  ClientSideBaseVisitor,
  ClientSideBasePluginConfig,
  getConfigValue,
  LoadedFragment,
  OMIT_TYPE,
  DocumentMode,
} from "@graphql-codegen/visitor-plugin-common";

import autoBind from "auto-bind";
import { GraphQLSchema, OperationDefinitionNode } from "graphql";
import { ApolloNextSSRRawPluginConfig, Config } from "./config";

export type ApolloNextSSRPluginConfig = ClientSideBasePluginConfig & Config;

export class ApolloNextSSRVisitor extends ClientSideBaseVisitor<
  ApolloNextSSRRawPluginConfig,
  ApolloNextSSRPluginConfig
> {
  private _externalImportPrefix: string;
  private imports = new Set<string>();

  constructor(
    schema: GraphQLSchema,
    fragments: LoadedFragment[],
    rawConfig: ApolloNextSSRRawPluginConfig,
    documents: Types.DocumentFile[]
  ) {
    super(schema, fragments, rawConfig, {
      apolloReactCommonImportFrom: getConfigValue(
        rawConfig.apolloReactCommonImportFrom,
        rawConfig.apolloVersion === 3
          ? "@apollo/client"
          : "@apollo/react-common"
      ),

      apolloReactHooksImportFrom: getConfigValue(
        rawConfig.apolloReactHooksImportFrom,
        rawConfig.apolloVersion === 3 ? "@apollo/client" : "@apollo/react-hooks"
      ),
      apolloImportFrom: getConfigValue(
        rawConfig.apolloImportFrom,
        rawConfig.apolloVersion === 3 ? "@apollo/client" : "apollo-client"
      ),

      apolloCacheImportFrom: getConfigValue(
        rawConfig.apolloCacheImportFrom,
        "apollo-cache-inmemory"
      ),

      apolloVersion: getConfigValue(rawConfig.apolloVersion, 2),
      excludePatterns: getConfigValue(rawConfig.excludePatterns, null),
      excludePatternsOptions: getConfigValue(
        rawConfig.excludePatternsOptions,
        ""
      ),

      pre: getConfigValue(rawConfig.pre, ""),
      post: getConfigValue(rawConfig.post, ""),
      customImports: getConfigValue(rawConfig.customImports, null),
    });

    this._externalImportPrefix = this.config.importOperationTypesFrom
      ? `${this.config.importOperationTypesFrom}.`
      : "";
    this._documents = documents;

    autoBind(this);
  }

  public getImports(): string[] {
    this.imports.add(`import { NextPage } from 'next';`);
    this.imports.add(`import { NextRouter, useRouter } from 'next/router'`);
    this.imports.add(
      `import { QueryHookOptions, useQuery } from '@apollo/react-hooks';`
    );
    this.imports.add(
      `import * as Apollo from '${this.config.apolloImportFrom}';`
    );
    this.imports.add(`import React from 'react';`);
    this.imports.add(
      `import { NormalizedCacheObject } from '${this.config.apolloCacheImportFrom}';`
    );

    if (this.config.customImports) {
      this.imports.add(this.config.customImports);
    }

    const baseImports = super.getImports();
    const hasOperations = this._collectedOperations.length > 0;

    if (!hasOperations) {
      return baseImports;
    }

    return [...baseImports, ...Array.from(this.imports)];
  }

  private _buildOperationPageQuery(
    node: OperationDefinitionNode,
    documentVariableName: string,
    operationResultType: string,
    operationVariablesTypes: string
  ): string {
    const operationName: string = this.convertName(node.name.value, {
      useTypesPrefix: false,
    });

    if (
      this.config.excludePatterns &&
      new RegExp(
        this.config.excludePatterns,
        this.config.excludePatternsOptions
      ).test(operationName)
    ) {
      return "";
    }

    const pageOperation = operationName
      .replace(/page/i, "")
      .replace(/query/i, "");

    const WrappedComp = `export type Page${pageOperation}Comp = React.FC<{data: ${operationResultType}, error: Apollo.ApolloError}>;`;

    const pageQueryString = `export const withPage${pageOperation} = (optionsFunc?: (router: NextRouter)=> QueryHookOptions<${operationResultType}, ${operationVariablesTypes}>) => (WrappedComponent:Page${pageOperation}Comp) : NextPage  => (props) => {
                const router = useRouter()
                const {data, error } = useQuery(Operations.${documentVariableName}, optionsFunc(router))    
                return <WrappedComponent {...props} data={data} error={error} /> ;
                   
            }; `;

    const getSSP = `export const getServerPage${pageOperation} = async (options: Apollo.QueryOptions<${operationVariablesTypes}>, apolloClient: Apollo.ApolloClient<NormalizedCacheObject>) => {
        await apolloClient.query({ ...options, query:Operations.${documentVariableName} });
        const apolloState = apolloClient.cache.extract();
        return {
            props: {
                apolloState,
            },
        };
      }`;

    const ssr = `export const ssr${pageOperation} = {
      getServerPage: getServerPage${pageOperation},
      withPage: withPage${pageOperation}
    }`;
    return [getSSP, WrappedComp, pageQueryString, ssr]
      .filter((a) => a)
      .join("\n");
  }

  protected buildOperation(
    node: OperationDefinitionNode,
    documentVariableName: string,
    operationType: string,
    operationResultType: string,
    operationVariablesTypes: string
  ): string {
    operationResultType = this._externalImportPrefix + operationResultType;
    operationVariablesTypes =
      this._externalImportPrefix + operationVariablesTypes;

    const cache = this._buildOperationPageQuery(
      node,
      documentVariableName,
      operationResultType,
      operationVariablesTypes
    );
    return [cache].join("\n");
  }
}
